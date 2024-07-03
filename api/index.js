import express from 'express';
import { ethers } from 'ethers';
import cors from 'cors';
import contractABI from '../abi/Book.json';
import erc20ABI from '../abi/ERC20.json'; 
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
const USDC_ADDRESS = process.env.USDC_ADDRESS ||'0xB1aEa92D4BF0BFBc2C5bA679A2819Efefc998CEB';
const WETH_ADDRESS = process.env.WETH_ADDRESS ||'0x25b8e42bdFC4cf8268B56B049d5C730762035407';

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
      const args = req.params[0].split('/').filter(arg => arg);

      // Convert boolean arguments from string to actual boolean type
      const parsedArgs = args.map(arg => (arg === 'true' ? true : arg === 'false' ? false : arg));

      // Log the arguments received
      console.log(`Function name: ${functionName}`);
      console.log(`Arguments: ${parsedArgs}`);

      const functionKey = `${functionName}:${parsedArgs.join(':')}`;
      let functionFromDB = await ContractFunction.findOne({ name: functionKey });

      if (!functionFromDB) {
        // Fetch from blockchain if no values in MongoDB
        const functionResult = await contract[functionName](...parsedArgs);

        // Log the result from the blockchain
        console.log(`Result from blockchain: ${functionResult.toString()}`);

        await ContractFunction.create({ name: functionKey, args: parsedArgs, result: functionResult.toString() });
        functionFromDB = { name: functionKey, args: parsedArgs, result: functionResult.toString() };
        console.log(`Function ${functionName} with args ${parsedArgs} fetched from blockchain and saved to DB.`);
      }

      req.functionResult = functionFromDB.result;
      res.json({ result: functionFromDB.result });

      // Update function result in background
      const functionResultFromBlockchain = await contract[functionName](...parsedArgs);
      if (functionFromDB.result !== functionResultFromBlockchain.toString()) {
        await ContractFunction.findOneAndUpdate(
          { name: functionKey },
          { result: functionResultFromBlockchain.toString(), updatedAt: new Date() },
          { upsert: true, new: true }
        );
        console.log(`Function ${functionName} with args ${parsedArgs} updated in the database.`);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Error in updateFunctionValue:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  } else {
    next();
  }
}

// Function to convert BigNumber to a readable format
const formatBigNumber = (balance, decimals) => {
  const factor = ethers.BigNumber.from(10).pow(decimals);
  const formattedBalance = balance.div(factor).toString() + "." + balance.mod(factor).toString().padStart(decimals, '0');
  return parseFloat(formattedBalance);
};

// Endpoint for USDC balance
app.get('/v1/balanceUSDC/:walletAddress', async (req, res) => {
  const { walletAddress } = req.params;

  if (!walletAddress) {
    return res.status(400).json({ error: "walletAddress is required" });
  }

  try {
    const usdcContract = new ethers.Contract(USDC_ADDRESS, erc20ABI, provider);
    const usdcBalance = await usdcContract.balanceOf(walletAddress);
    const formattedBalance = formatBigNumber(usdcBalance, 18); 

    res.json({
      balance: formattedBalance
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    res.status(500).json({ error: err.message });
  }
});

// Endpoint for WETH balance
app.get('/v1/balanceWETH/:walletAddress', async (req, res) => {
  const { walletAddress } = req.params;

  if (!walletAddress) {
    return res.status(400).json({ error: "walletAddress is required" });
  }

  try {
    const wethContract = new ethers.Contract(WETH_ADDRESS, erc20ABI, provider);
    const wethBalance = await wethContract.balanceOf(walletAddress);
    const formattedBalance = formatBigNumber(wethBalance, 18); 

    res.json({
      balance: formattedBalance
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    res.status(500).json({ error: err.message });
  }
});


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
 * /v1/request/{functionName}/*:
 *   get:
 *     summary: Call a function of the smart contract
 *     parameters:
 *       - in: path
 *         name: functionName
 *         required: true
 *         description: Name of the function to call
 *         schema:
 *           type: string
 *       - in: path
 *         name: '*'
 *         required: false
 *         description: Arguments for the function
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
app.get('/v1/request/:functionName/*', updateFunctionValue, (req, res) => {});


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