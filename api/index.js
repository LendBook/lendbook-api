import express from 'express';
import { ethers } from 'ethers';
import cors from 'cors';
import contractABI from '../abi/Book.json';
import dotenv from 'dotenv';
import swaggerJsdoc from 'swagger-jsdoc';
import { serve, setup } from 'swagger-ui-express';
import swaggerDocument from '../swagger.json';
import mongoose from 'mongoose';
import cron from 'node-cron';

dotenv.config();

const app = express();

const urlProvider = process.env.URL_PROVIDER || '';
const contractAddress = process.env.CONTRACT_ADDRESS || '';
const chainId = process.env.CHAIN_ID || '';
const mongoUri = process.env.MONGO_URI || '';

mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });

const blockchainSchema = new mongoose.Schema({
  blockNumber: Number,
  updatedAt: { type: Date, default: Date.now },
});

const constantSchema = new mongoose.Schema({
  name: String,
  value: String,
  updatedAt: { type: Date, default: Date.now },
});

const functionSchema = new mongoose.Schema({
  name: String,
  args: [String],
  result: String,
  updatedAt: { type: Date, default: Date.now },
});

const BlockchainState = mongoose.model('BlockchainState', blockchainSchema);
const Constant = mongoose.model('Constant', constantSchema);
const ContractFunction = mongoose.model('ContractFunction', functionSchema);

const provider = new ethers.JsonRpcProvider(urlProvider, chainId ? parseInt(chainId) : undefined);
const contract = new ethers.Contract(contractAddress, contractABI, provider);

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Lendbook API',
      version: '1.0.0',
    },
  },
  apis: ['./api/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

app.use(cors({
  origin: ['https://api.lendbook.org/api-docs']
}));

app.use('/api-docs', serve, setup(swaggerDocument));

// Function to fetch and update blockchain state (for cron job)
async function fetchAndUpdateBlockchainState() {
  try {
    const currentBlockNumber = await provider.getBlockNumber();
    const latestState = await BlockchainState.findOne().sort({ updatedAt: -1 });

    if (!latestState || latestState.blockNumber !== currentBlockNumber) {
      await BlockchainState.create({ blockNumber: currentBlockNumber });
      console.log('Blockchain state updated.');
    } else {
      console.log('Blockchain state is up-to-date.');
    }
  } catch (error) {
    console.error('Error fetching or updating blockchain state:', error);
  }
}

// Run every 10 seconds
cron.schedule('*/10 * * * * *', fetchAndUpdateBlockchainState);

// Middleware to update database (Compare between Sepolia blockchain and MONGO DB)
async function updateConstantValue(req, res, next) {
  if (req.params.constantName) {
    try {
      const constantName = req.params.constantName;
      let constantFromDB = await Constant.findOne({ name: constantName });

      if (!constantFromDB) {
        // Fetch from blockchain if no values in MongoDB
        const constantValue = await contract[constantName]();
        await Constant.create({ name: constantName, value: constantValue.toString() });
        constantFromDB = { name: constantName, value: constantValue.toString() };
        console.log(`Constant ${constantName} fetched from blockchain and saved to DB.`);
      }

      req.constantValue = constantFromDB.value;
      res.json({ [constantName]: constantFromDB.value });

      // Update value in background
      const constantValueFromBlockchain = await contract[constantName]();
      if (constantFromDB.value !== constantValueFromBlockchain.toString()) {
        await Constant.findOneAndUpdate(
          { name: constantName },
          { value: constantValueFromBlockchain.toString(), updatedAt: new Date() },
          { upsert: true, new: true }
        );
        console.log(`Constant ${constantName} updated in the database.`);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  } else {
    next();
  }
}

// Middleware to update function values
async function updateFunctionValue(req, res, next) {
  if (req.params.functionName) {
    try {
      const functionName = req.params.functionName;
      const args = req.params[0].split('/');
      const functionKey = `${functionName}:${args.join(':')}`;
      let functionFromDB = await ContractFunction.findOne({ name: functionKey });

      if (!functionFromDB) {
        // Fetch from blockchain if no values in MongoDB
        const functionResult = await contract[functionName](...args);
        await ContractFunction.create({ name: functionKey, args, result: functionResult.toString() });
        functionFromDB = { name: functionKey, args, result: functionResult.toString() };
        console.log(`Function ${functionName} with args ${args} fetched from blockchain and saved to DB.`);
      }

      req.functionResult = functionFromDB.result;
      res.json({ result: functionFromDB.result });

      // Update function result in background
      const functionResultFromBlockchain = await contract[functionName](...args);
      if (functionFromDB.result !== functionResultFromBlockchain.toString()) {
        await ContractFunction.findOneAndUpdate(
          { name: functionKey },
          { result: functionResultFromBlockchain.toString(), updatedAt: new Date() },
          { upsert: true, new: true }
        );
        console.log(`Function ${functionName} with args ${args} updated in the database.`);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  } else {
    next();
  }
}

/**
 * @swagger
 * /v1/blockNumber:
 *   get:
 *     summary: Get the current block number
 *     responses:
 *       200:
 *         description: Success
 */
app.get('/v1/blockNumber', async (req, res) => {
  try {
    const latestState = await BlockchainState.findOne().sort({ updatedAt: -1 });
    if (latestState) {
      res.json({ blockNumber: latestState.blockNumber });
    } else {
      const blockNumber = await provider.getBlockNumber();
      res.json({ blockNumber });
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /v1/contractAddress:
 *   get:
 *     summary: Get the address of the smart contract
 *     responses:
 *       200:
 *         description: Success
 */
app.get('/v1/contractAddress', (req, res) => {
  res.json({ contractAddress });
});

/**
 * @swagger
 * /v1/request/{functionName}:
 *   get:
 *     summary: Call a function of the smart contract
 *     parameters:
 *       - in: path
 *         name: functionName
 *         required: true
 *         description: Name of the function to call
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
app.get('/v1/request/:functionName/*', updateFunctionValue, (req, res) => {
});

/**
 * @swagger
 * /v1/constant/{constantName}:
 *   get:
 *     summary: Get the value of a constant from the smart contract
 *     parameters:
 *       - in: path
 *         name: constantName
 *         required: true
 *         description: Name of the constant to retrieve
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
app.get('/v1/constant/:constantName', updateConstantValue, (req, res) => {
});

/**
 * @swagger
 * /api-docs:
 *   get:
 *     summary: Get the Swagger documentation of the API
 *     responses:
 *       200:
 *         description: Success
 */
app.get('/api-docs', (req, res) => {
  res.send(swaggerSpec);
});

app.use((req, res) => {
  res.status(404).json({ error: "API Endpoint Not Found" });
});

/**
 * @swagger
 * /:
 *   get:
 *     summary: API Home Page
 *     responses:
 *       200:
 *         description: API Online
 */
app.get('/', (req, res) => {
  res.send('API Online');
});

export default app;
