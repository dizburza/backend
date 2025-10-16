# 🧪 Dizburza API Testing Guide

Complete guide for testing all API endpoints using Thunder Client (or any REST client).

---

## 🚀 Setup

**Base URL:** `http://localhost:3000/api`

**Prerequisites:**
- Backend server running on port 3000
- MongoDB connected
- Valid wallet addresses for testing

---

## 📝 Test Sequence

### **TEST 1: Health Check** ✅

**Method:** `GET`  
**URL:** `http://localhost:3000/api/health`

**Expected Response:**
```json
{
  "success": true,
  "message": "Server is running",
  "timestamp": "2025-01-15T..."
}
```

---

### **TEST 2: Register User** 👤

**Method:** `POST`  
**URL:** `http://localhost:3000/api/auth/register`

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
  "surname": "Doe",
  "firstname": "John",
  "email": "john@example.com",
  "avatar": "https://api.dicebear.com/7.x/avataaars/svg?seed=John"
}
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "username": "doe_ohn_742d35",
      "walletAddress": "0x742d35cc6634c0532925a3b844bc9e7595f0beb1",
      "fullName": "John Doe",
      "role": "employee"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "redirectTo": "/wallet"
  },
  "message": "User registered successfully"
}
```

**📝 Important:** Copy the `token` - you'll need it for authenticated requests!

---

### **TEST 3: Get My Profile** 🔐

**Method:** `GET`  
**URL:** `http://localhost:3000/api/auth/me`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
```

> Replace `YOUR_TOKEN_HERE` with the token from TEST 2

---

### **TEST 4: Check User Status**

**Method:** `GET`  
**URL:** `http://localhost:3000/api/auth/check/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1`

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "isRegistered": true,
    "redirectTo": "/wallet",
    "user": { ... }
  }
}
```

---

### **TEST 5: Get Auth Message**

**Method:** `GET`  
**URL:** `http://localhost:3000/api/auth/message/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1`

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "message": "Welcome to Dizburza!\n\nSign this message to authenticate..."
  }
}
```

---

### **TEST 6: Get Wallet Balance**

**Method:** `GET`  
**URL:** `http://localhost:3000/api/wallet/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1/balance`

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "address": "0x742d35cc6634c0532925a3b844bc9e7595f0beb1",
    "balance": "0.0",
    "currency": "cNGN"
  }
}
```

---

### **TEST 7: Get Wallet Summary**

**Method:** `GET`  
**URL:** `http://localhost:3000/api/wallet/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1/summary`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
```

---

### **TEST 8: Get Transaction History**

**Method:** `GET`  
**URL:** `http://localhost:3000/api/transactions/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1?page=1&limit=10`

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Results per page (default: 50)
- `type` (optional): Filter by type (send, receive, payroll, etc.)
- `category` (optional): Filter by category

---

### **TEST 9: Create Organization** 🏢

**Method:** `POST`  
**URL:** `http://localhost:3000/api/organizations`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json
```

**Body:**
```json
{
  "name": "Tech Innovations Ltd",
  "contractAddress": "0x1234567890abcdef1234567890abcdef12345678",
  "creatorAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
  "cacNumber": "RC123456",
  "industry": "Information Technology",
  "size": "11-50",
  "registeredAddress": "123 Tech Street, Lagos, Nigeria",
  "signers": [
    {
      "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
      "name": "John Doe",
      "role": "CEO"
    }
  ],
  "quorum": 1
}
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Tech Innovations Ltd",
    "slug": "tech-innovations-ltd",
    "contractAddress": "0x1234567890abcdef1234567890abcdef12345678",
    ...
  },
  "message": "Organization created successfully"
}
```

**📝 Important:** Copy the `_id` and `slug` - you'll need them!

---

### **TEST 10: Get All Organizations**

**Method:** `GET`  
**URL:** `http://localhost:3000/api/organizations`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
```

---

### **TEST 11: Get Organization by Slug**

**Method:** `GET`  
**URL:** `http://localhost:3000/api/organizations/slug/tech-innovations-ltd`

---

### **TEST 12: Create Batch Payroll** 💰

**Method:** `POST`  
**URL:** `http://localhost:3000/api/payroll/batches`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json
```

**Body:**
```json
{
  "batchName": "january_2025_payroll",
  "organizationId": "507f1f77bcf86cd799439011",
  "organizationAddress": "0x1234567890abcdef1234567890abcdef12345678",
  "creatorAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
  "recipients": [
    {
      "walletAddress": "0x9876543210fedcba9876543210fedcba98765432",
      "amount": "5000000000"
    }
  ]
}
```

> **Note:** Amount is in smallest unit (6 decimals for cNGN). `5000000000` = 5,000 cNGN

---

### **TEST 13: Get Batches for Organization**

**Method:** `GET`  
**URL:** `http://localhost:3000/api/payroll/organizations/507f1f77bcf86cd799439011/batches`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Query Parameters (optional):**
- `status`: Filter by status (pending, approved, executed, cancelled)

---

### **TEST 14: Approve Batch**

**Method:** `POST`  
**URL:** `http://localhost:3000/api/payroll/batches/january_2025_payroll/approve`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json
```

**Body:**
```json
{
  "signerAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
  "signerName": "John Doe"
}
```

---

### **TEST 15: Search User by Username** 🔍

**Method:** `GET`  
**URL:** `http://localhost:3000/api/users/search/doe_ohn_742d35`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
```

---

### **TEST 16: Suggest Usernames** 💡

**Method:** `GET`  
**URL:** `http://localhost:3000/api/users/suggest?query=doe`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
```

---

## 📋 Complete API Endpoints Reference

### **Authentication**
```
POST   /auth/register          - Register new user
POST   /auth/login             - Login with signature
GET    /auth/check/:address    - Check user status
GET    /auth/message/:address  - Get message to sign
GET    /auth/me                - Get current user profile
```

### **Wallet**
```
GET    /wallet/:address/balance                 - Get balance
GET    /wallet/:address/summary                 - Get wallet summary
POST   /wallet/:address/sync                    - Sync transaction history
```

### **Transactions**
```
GET    /transactions/:address                   - Get transaction history
POST   /transactions/record                     - Record new transaction
```

### **Organizations**
```
POST   /organizations                           - Create organization
GET    /organizations                           - Get all organizations
GET    /organizations/signer/:address           - Get org by signer
GET    /organizations/slug/:slug                - Get org by slug
GET    /organizations/:id                       - Get org by ID
POST   /organizations/:id/employees             - Add employee
```

### **Payroll**
```
POST   /payroll/batches                         - Create batch
POST   /payroll/batches/:name/approve           - Approve batch
POST   /payroll/batches/:name/execute           - Execute batch
POST   /payroll/batches/:name/cancel            - Cancel batch
GET    /payroll/organizations/:id/batches       - Get org batches
GET    /payroll/batches/:name                   - Get batch details
```

### **Users**
```
GET    /users/search/:username                  - Search by username
GET    /users/suggest?query=...                 - Auto-suggest usernames
POST   /users/batch-lookup                      - Lookup multiple users
```

---

## 💡 Tips for Testing

### **Using Thunder Client (Free Version)**

1. **Save Important Values:**
   Create a text file to store:
   - Tokens
   - Organization IDs
   - Wallet addresses
   - Batch names

2. **Save Requests:**
   After creating each request, click "Save" to reuse later

3. **Use Collections:**
   Group related tests together (Auth, Wallet, Payroll, etc.)

4. **Use History:**
   Quickly re-run previous tests from the History tab

### **Recommended Test Flow**
```
1. Health Check
   ↓
2. Register User
   ↓
3. Get Profile
   ↓
4. Create Organization
   ↓
5. Search & Add Signers
   ↓
6. Create Batch Payroll
   ↓
7. Approve Batch
   ↓
8. Execute Batch
```

### **Common Issues**

**401 Unauthorized:**
- Check if token is included in headers
- Token might be expired (24h validity)
- Register or login again to get new token

**404 Not Found:**
- Verify the endpoint URL
- Check if resource exists (organization ID, batch name, etc.)

**400 Bad Request:**
- Check request body format
- Ensure all required fields are included
- Validate data types (strings, numbers, arrays)

---

## 📊 Response Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| 200 | OK | Request successful |
| 201 | Created | Resource created successfully |
| 400 | Bad Request | Invalid request data |
| 401 | Unauthorized | Authentication required or token invalid |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 500 | Server Error | Internal server error |

---

## 🔐 Security Notes

- Tokens expire after 24 hours
- Always use HTTPS in production
- Never commit tokens or secrets to git
- Rotate tokens regularly
- Validate all input data

---

**Happy Testing! 🎉**