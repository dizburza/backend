# Payroll & Banking Backend

## Features

- 🏦 Banking system with transaction tracking
- 💰 Payroll management with multisig approval
- 📊 Spending analytics and insights
- 📄 Statement generation (PDF)
- 🔐 Wallet-based authentication
- ⛓️ Blockchain event listening
- 🚀 RESTful API

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB 6+
- cNGN token access

### Installation

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
nano .env

# Run development server
npm run dev
```

### Build for Production

```bash
npm run build
npm start
```

## API Endpoints

### Authentication
- POST `/api/auth/register` - Register new user
- POST `/api/auth/login` - Login with wallet signature
- GET `/api/auth/message/:address` - Get auth message
- GET `/api/auth/me` - Get current user profile

### Wallet
- GET `/api/wallet/:address/balance` - Get balance
- GET `/api/wallet/:address/summary` - Get wallet summary
- POST `/api/wallet/:address/sync` - Sync transaction history

### Transactions
- GET `/api/transactions/:address` - Get transaction history
- POST `/api/transactions/record` - Record transaction

### Analytics
- GET `/api/analytics/:address/:period` - Get spending analytics
- GET `/api/analytics/:address/spending-by-category` - Category breakdown
- GET `/api/analytics/:address/statement` - Generate statement

### Organizations
- POST `/api/organizations` - Create organization
- GET `/api/organizations/signer/:address` - Get signer's organization
- POST `/api/organizations/:id/employees` - Add employee

### Payroll
- POST `/api/payroll/batches` - Create batch payroll
- POST `/api/payroll/batches/:batchName/approve` - Approve batch
- POST `/api/payroll/batches/:batchName/execute` - Execute batch
- GET `/api/payroll/organizations/:id/batches` - Get organization batches

## Project Structure

```
src/
├── config/          # Configuration files
├── models/          # MongoDB models
├── controllers/     # Route controllers
├── services/        # Business logic
├── routes/          # API routes
├── middlewares/     # Express middlewares
├── utils/           # Utility functions
├── types/           # TypeScript types
├── listeners/       # Blockchain listeners
├── app.ts           # Express app setup
└── server.ts        # Server entry point
```

## License

MIT