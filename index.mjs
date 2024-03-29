import express from 'express';
import { ethers } from 'ethers';
import contractABI from './abi/book.json' assert { type: 'json' };
import dotenv from 'dotenv';
import swaggerJsdoc from 'swagger-jsdoc';
import { serve, setup } from 'swagger-ui-express';
import swaggerDocument from './swagger.json' assert { type: 'json' };

dotenv.config();

const app = express();
const urlProvider = process.env.URL_PROVIDER || '';
const contractAddress = process.env.CONTRACT_ADDRESS || '';
const chainId = process.env.CHAIN_ID || '';

const provider = new ethers.JsonRpcProvider(urlProvider, chainId ? parseInt(chainId) : undefined);
const contract = new ethers.Contract(contractAddress, contractABI, provider);

const options = {
  definition: {
    openapi: '3.0.0', // OpenAPI version
    info: {
      title: 'Lendbook API', // API title
      version: '1.0.0', // API version
    },
  },
  // Files containing Swagger comments
  apis: ['./routes/*.js', './models/*.js'],
};

// Initialize swagger-jsdoc
const swaggerSpec = swaggerJsdoc(options);

// Middleware to expose Swagger documentation
app.use('/api-docs', serve, setup(swaggerDocument));

/**
 * @swagger
 * /api/v1/blockNumber:
 *   get:
 *     summary: Get the current block number
 *     responses:
 *       200:
 *         description: Success
 */
app.get('/api/v1/blockNumber', async (req, res) => {
  try {
    const blockNumber = await provider.getBlockNumber();
    res.json({ blockNumber });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/v1/contractAddress:
 *   get:
 *     summary: Get the address of the smart contract
 *     responses:
 *       200:
 *         description: Success
 */
app.get('/api/v1/contractAddress', (req, res) => {
  res.json({ contractAddress });
});

/**
 * @swagger
 * /api/v1/request/{functionName}:
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
app.get('/api/v1/request/:functionName/*', async (req, res) => {
  try {
    const functionName = req.params.functionName;
    const args = req.params[0].split('/');
    
    // Use the corresponding contract function
    const contractFunction = contract[functionName];
    if (!contractFunction || typeof contractFunction !== 'function') {
      return res.status(404).json({ error: "Function does not exist in the contract" });
    }
    
    const result = await contractFunction(...args);
    res.json({ result: result.toString() });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    res.status(500).json({ error: err.message });
  }
});


/**
 * @swagger
 * /api/v1/constant/{constantName}:
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
app.get('/api/v1/constant/:constantName', async (req, res) => {
  try {
    const constantName = req.params.constantName;
    
    if (!contract[constantName]) {
      return res.status(404).json({ error: "Constant does not exist in the contract" });
    }

    const constantValue = await contract[constantName]();

    res.json({ [constantName]: constantValue.toString() });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    res.status(500).json({ error: err.message });
  }
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

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`API started at http://localhost:${port}`);
});
