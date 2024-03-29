# LendBook API

## Description

The LendBook API provides endpoints to interact with a smart contract. It allows users to retrieve information such as the current block number, contract address, call contract functions, and access contract constants.

## Getting Started

### Prerequisites

1. Node.js and npm installed on your machine.
2. An Ethereum node URL (e.g., Infura) for provider communication.
3. A contract ABI JSON file.
4. Set up a `.env` file with the following environment variables:

```
URL_PROVIDER=<Your Ethereum node URL>
CONTRACT_ADDRESS=<Your contract address>
CHAIN_ID=<Your chain ID>
```

### Installation

1. Clone this repository to your local machine.
2. Navigate to the project directory in your terminal.
3. Run `yarn install` to install dependencies.

### Usage

1. Start the API server by running `yarn serve`.
2. Access the API endpoints using your preferred HTTP client (e.g., Postman).

### Swagger Documentation

1. Access the Swagger documentation at `/api-docs` endpoint.
2. Explore the available endpoints and their descriptions.

## Endpoints

### GET /api/v1/blockNumber

Returns the current block number on the Ethereum blockchain.

### GET /api/v1/contractAddress

Returns the address of the smart contract.

### GET /api/v1/request/{functionName}

Calls a function of the smart contract by providing the function name as a parameter.

### GET /api/v1/constant/{constantName}

Returns the value of a constant from the smart contract by providing the constant name as a parameter.

## Contributing

Contributions are welcome! Please fork the repository, make your changes, and submit a pull request.

## License

This project is licensed under the [MIT License](LICENSE).
