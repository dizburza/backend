# 🚀 Dizburza Backend - Blockchain Payroll System

A modern, secure backend for managing blockchain-based payroll with cNGN token integration.

---

## ✨ Features

- 🔐 **Wallet-based Authentication** - Secure login with Web3 signatures
- 💰 **Multi-signature Payroll** - Batch payments with approval workflow
- 🏢 **Organization Management** - Create and manage companies with signers
- 👥 **Employee Management** - Add employees with job details and salary tracking
- 📊 **Transaction History** - Track all cNGN transfers and payroll disbursements
- ⛓️ **Blockchain Integration** - Real-time event listening from smart contracts
- 🔍 **Search & Discovery** - Find users by username or wallet address
- 📈 **Analytics Ready** - Built-in support for spending insights

---

## 🛠️ Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** Express.js + TypeScript
- **Database:** MongoDB 6+
- **Blockchain:** ethers.js v6 (Lisk Sepolia Testnet)
- **Authentication:** JWT + Web3 signatures
- **Validation:** express-validator
- **Security:** Helmet, CORS, Rate limiting

---

## 📋 Prerequisites

Before you begin, ensure you have:

- Node.js 18 or higher
- MongoDB 6 or higher (local or Atlas)
- A Lisk Sepolia RPC endpoint
- cNGN token contract address
- Basic understanding of blockchain/Web3

---

## 🚀 Quick Start

### 1. Clone and Install

```bash
# Clone the repository
git clone <your-repo-url>
cd backend

# Install dependencies
npm install
```

### 2. Environment Setup

```bash
# Copy environment template
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Server
PORT=5000
NODE_ENV=development
API_URL=http://localhost:5000

# Database
MONGODB_URI=mongodb://localhost:27017/dizburza

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-this
JWT_EXPIRY=24h

# Blockchain
BLOCKCHAIN_RPC_URL=https://rpc.sepolia-api.lisk.com
CNNG_CONTRACT_ADDRESS=0x...
PRIVATE_KEY=your-private-key-for-event-listening

# Frontend
FRONTEND_URL=http://localhost:3000

# Rate Limiting
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX=100
```

### 3. Run Development Server

```bash
# Development mode (with auto-reload)
npm run dev

# Build for production
npm run build

# Run production server
npm start
```

**Expected Output:**
```
✅ Database connected
🎧 Starting blockchain event listener...
✅ Blockchain listener started successfully
🚀 Server running on port 5000
📡 Environment: development
🌍 API URL: http://localhost:5000/api
```

---

## 📡 API Overview

### Base URL
```
http://localhost:5000/api
```

### Quick Test
```bash
# Health check
curl http://localhost:5000/api/health
```

**Response:**
```json
{
  "success": true,
  "message": "Server is running",
  "timestamp": "2025-01-15T..."
}
```

---

## 🔑 Key Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register new user |
| POST | `/auth/login` | Login with wallet signature |
| GET | `/auth/me` | Get current user profile |

### Organizations
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/organizations` | Create organization |
| GET | `/organizations/:id/employees` | Get all employees |
| POST | `/organizations/:id/employees` | Add employee with job details |

### Payroll
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/payroll/batches` | Create batch payroll |
| POST | `/payroll/batches/:name/approve` | Approve batch |
| POST | `/payroll/batches/:name/execute` | Execute batch |

### Wallet & Transactions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/wallet/:address/balance` | Get cNGN balance |
| GET | `/transactions/:address` | Get transaction history |

📖 **[View Complete API Documentation →](./API_TESTING_GUIDE.md)**

---

## 🏗️ Project Structure

```
src/
├── config/              # Configuration (database, blockchain, env)
├── controllers/         # Route controllers (request handlers)
├── services/            # Business logic layer
├── models/              # MongoDB/Mongoose models
├── routes/              # API route definitions
├── middlewares/         # Express middlewares (auth, validation, etc.)
├── types/               # TypeScript type definitions
├── utils/               # Utility functions (crypto, validation, etc.)
├── listeners/           # Blockchain event listeners
├── app.ts               # Express app configuration
└── server.ts            # Server entry point
```

---

## 🔐 Security Features

- ✅ **JWT Authentication** with wallet signatures
- ✅ **Role-based Access Control** (Employee, Signer, Admin)
- ✅ **Rate Limiting** on sensitive endpoints
- ✅ **Input Validation** on all requests
- ✅ **NoSQL Injection Protection**
- ✅ **CORS Configuration**
- ✅ **Helmet Security Headers**
- ✅ **Request Logging** for audit trails

---

## 🧪 Testing

### Using Thunder Client (VSCode)

1. Open Thunder Client in VSCode
2. Import requests from `API_TESTING_GUIDE.md`
3. Follow the test sequence

### Manual Testing with curl

```bash
# Register a user
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
    "surname": "Doe",
    "firstname": "John",
    "email": "john@example.com"
  }'

# Get balance
curl http://localhost:5000/api/wallet/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1/balance
```

---

## 🔄 Architecture: Hybrid Approach

The backend uses a **hybrid architecture** for optimal security and performance:

### Frontend → Smart Contract (Direct)
✅ **User-initiated transactions:**
- Creating organizations
- Creating batch payrolls
- Approving batches
- Executing payrolls

### Backend → Database (Records)
✅ **After blockchain confirmation:**
- Records transaction details
- Stores user/organization data
- Provides fast queries
- Generates analytics

### Backend → Blockchain (Listening)
✅ **Event monitoring:**
- Listens to Transfer events
- Syncs blockchain data
- Updates transaction status

---

## 📦 Database Models

### Core Models
- **User** - User accounts with wallet addresses
- **Organization** - Companies with multi-sig setup
- **BatchPayroll** - Payroll batches with approval workflow
- **Transaction** - Transaction history and tracking

### Key Relationships
```
Organization (1) ─── (N) Users (employees)
Organization (1) ─── (N) BatchPayroll
BatchPayroll (1) ─── (N) Recipients
User (1) ─── (N) Transactions
```

---

## 🚦 Available Scripts

```bash
npm run dev          # Start development server (auto-reload)
npm run build        # Build for production
npm start            # Start production server
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
```

---

## 🐛 Common Issues

### Port Already in Use
```bash
# Kill process on port 5000
lsof -ti:5000 | xargs kill -9
```

### MongoDB Connection Error
- Ensure MongoDB is running
- Check `MONGODB_URI` in `.env`
- Verify network connectivity

### Blockchain Listener Not Starting
- Check `BLOCKCHAIN_RPC_URL` is valid
- Verify `CNNG_CONTRACT_ADDRESS` is correct
- Ensure private key has permissions

---

## 📝 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | No (default: 5000) |
| `MONGODB_URI` | MongoDB connection string | Yes |
| `JWT_SECRET` | JWT signing secret | Yes |
| `BLOCKCHAIN_RPC_URL` | Lisk Sepolia RPC endpoint | Yes |
| `CNNG_CONTRACT_ADDRESS` | cNGN token address | Yes |
| `FRONTEND_URL` | Frontend URL for CORS | Yes |

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License.

---

## 🔗 Related Links

- [Frontend Repository](#)
- [Smart Contracts Repository](#)
- [Documentation](#)
- [API Testing Guide](./API_TESTING_GUIDE.md)

---

## 💬 Support

For issues and questions:
- Open an issue on GitHub
- Contact: your-email@example.com

---

**Built with ❤️ for decentralized payroll management**