# 🧪 Dizburza API Testing Guide

Complete guide for testing all API endpoints using Thunder Client (or any REST client).

---

## 🚀 Setup

**Base URL:** `http://localhost:5000/api`

**Prerequisites:**
- Backend server running on port 5000
- MongoDB connected
- Valid wallet addresses for testing

---

## 📝 Test Sequence

### **TEST 1: Health Check** ✅

**Method:** `GET`  
**URL:** `http://localhost:5000/api/health`

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
**URL:** `http://localhost:5000/api/auth/register`

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
      "username": "doe_john_742d35",
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
**URL:** `http://localhost:5000/api/auth/me`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
```

> Replace `YOUR_TOKEN_HERE` with the token from TEST 2

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "username": "doe_john_742d35",
      "fullName": "John Doe",
      "walletAddress": "0x742d35cc6634c0532925a3b844bc9e7595f0beb1",
      "email": "john@example.com",
      "role": "employee",
      "organizationId": null
    }
  }
}
```

---

### **TEST 4: Check User Status**

**Method:** `GET`  
**URL:** `http://localhost:5000/api/auth/check/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1`

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
**URL:** `http://localhost:5000/api/auth/message/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1`

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
**URL:** `http://localhost:5000/api/wallet/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1/balance`

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
**URL:** `http://localhost:5000/api/wallet/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1/summary`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "balance": "0.0",
    "recentTransactions": [],
    "monthlyAnalytics": null
  }
}
```

---

### **TEST 8: Get Transaction History**

**Method:** `GET`  
**URL:** `http://localhost:5000/api/transactions/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1?page=1&limit=10`

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Results per page (default: 50)
- `type` (optional): Filter by type (send, receive, payroll, etc.)
- `category` (optional): Filter by category
- `status` (optional): Filter by status

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "transactions": [],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 0,
      "totalPages": 0,
      "hasMore": false
    }
  }
}
```

---

### **TEST 9: Create Organization** 🏢

**Method:** `POST`  
**URL:** `http://localhost:5000/api/organizations`

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
  "businessEmail": "info@techinnovations.com",
  "businessInfo": {
    "registrationNumber": "RC123456",
    "registrationType": "Limited Liability Company (Ltd)"
  },
  "signers": [
    {
      "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
      "name": "John Doe",
      "role": "CEO"
    }
  ],
  "quorum": 1,
  "metadata": {
    "industry": "Information Technology",
    "size": "11-50",
    "description": "A leading tech company"
  }
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
    "creatorAddress": "0x742d35cc6634c0532925a3b844bc9e7595f0beb1",
    "businessEmail": "info@techinnovations.com",
    "signers": [...],
    "quorum": 1
  },
  "message": "Organization created successfully"
}
```

**📝 Important:** 
- Copy the `_id` - you'll need it for employee management and payroll!
- Your user's role is now automatically updated to "signer"
- Re-login to get a new token with the signer role

---

### **TEST 10: Get All Organizations**

**Method:** `GET`  
**URL:** `http://localhost:5000/api/organizations`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
```

---

### **TEST 11: Get Organization by Slug**

**Method:** `GET`  
**URL:** `http://localhost:5000/api/organizations/slug/tech-innovations-ltd`

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "name": "Tech Innovations Ltd",
    "slug": "tech-innovations-ltd",
    "signers": [...],
    "employees": [...],
    "quorum": 1
  }
}
```

---

### **TEST 12: Register Employee User** 👤

Before adding employees to an organization, they must be registered first.

**Method:** `POST`  
**URL:** `http://localhost:5000/api/auth/register`

**Body:**
```json
{
  "walletAddress": "0x9876543210fedcba9876543210fedcba98765432",
  "surname": "Johnson",
  "firstname": "Alice",
  "email": "alice@example.com"
}
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "username": "johnson_alice_987654",
      "fullName": "Alice Johnson",
      "role": "employee"
    },
    "token": "..."
  }
}
```

**📝 Copy the username** - you'll need it to add this user as an employee!

---

### **TEST 13: Add Employee to Organization** 👥

**Method:** `POST`  
**URL:** `http://localhost:5000/api/organizations/507f1f77bcf86cd799439011/employees`

**Headers:**
```
Authorization: Bearer YOUR_SIGNER_TOKEN
Content-Type: application/json
```

> ⚠️ **Important:** Use the signer's token, not the employee's token!

**Body:**
```json
{
  "username": "johnson_alice_987654",
  "jobRole": "Senior Developer",
  "salary": "5000000000",
  "department": "Engineering", // optional
  "employeeId": "EMP001" // optional
}
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "username": "johnson_alice_987654",
    "fullName": "Alice Johnson",
    "walletAddress": "0x9876543210fedcba9876543210fedcba98765432",
    "email": "alice@example.com",
    "organizationId": "507f1f77bcf86cd799439011",
    "organizationSlug": "tech-innovations-ltd",
    "jobDetails": {
      "jobRole": "Senior Developer",
      "salary": "5000000000",
      "department": "Engineering",
      "employeeId": "EMP001",
      "joinedAt": "2025-01-15T..."
    },
    "role": "employee"
  },
  "message": "Employee added successfully"
}
```

> **Note:** Amount is in smallest unit (6 decimals for cNGN). `5000000000` = 5,000 cNGN

---

### **TEST 14: Get Organization Employees**

**Method:** `GET`  
**URL:** `http://localhost:5000/api/organizations/507f1f77bcf86cd799439011/employees`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "organization": {
      "name": "Tech Innovations Ltd",
      "slug": "tech-innovations-ltd"
    },
    "employees": [
      {
        "_id": "...",
        "username": "johnson_alice_987654",
        "fullName": "Alice Johnson",
        "surname": "Johnson",
        "firstname": "Alice",
        "walletAddress": "0x9876543210fedcba9876543210fedcba98765432",
        "email": "alice@example.com",
        "avatar": "...",
        "jobDetails": {
          "jobRole": "Senior Developer",
          "salary": "5000000000",
          "department": "Engineering",
          "employeeId": "EMP001",
          "joinedAt": "2025-01-15T..."
        },
        "role": "employee",
        "createdAt": "2025-01-15T..."
      }
    ],
    "totalEmployees": 1
  }
}
```

---

### **TEST 15: Update Employee Details**

**Method:** `PATCH`  
**URL:** `http://localhost:5000/api/organizations/507f1f77bcf86cd799439011/employees/johnson_alice_987654`

**Headers:**
```
Authorization: Bearer YOUR_SIGNER_TOKEN
Content-Type: application/json
```

**Body:**
```json
{
  "salary": "6000000000",
  "jobRole": "Lead Developer",
  "department": "Engineering"
}
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "username": "johnson_alice_987654",
    "fullName": "Alice Johnson",
    "jobDetails": {
      "jobRole": "Lead Developer",
      "salary": "6000000000",
      "department": "Engineering",
      "employeeId": "EMP001",
      "joinedAt": "2025-01-15T..."
    }
  },
  "message": "Employee updated successfully"
}
```

---

### **TEST 16: Remove Employee from Organization**

**Method:** `DELETE`  
**URL:** `http://localhost:5000/api/organizations/507f1f77bcf86cd799439011/employees/johnson_alice_987654`

**Headers:**
```
Authorization: Bearer YOUR_SIGNER_TOKEN
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "username": "johnson_alice_987654",
    "fullName": "Alice Johnson",
    "organizationId": null,
    "organizationSlug": null,
    "jobDetails": null,
    "role": "employee"
  },
  "message": "Employee removed successfully"
}
```

---

### **TEST 17: Create Batch Payroll** 💰

**Method:** `POST`  
**URL:** `http://localhost:5000/api/payroll/batches`

**Headers:**
```
Authorization: Bearer YOUR_SIGNER_TOKEN
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
      "amount": "5000000000",
      "employeeName": "Alice Johnson"
    }
  ]
}
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "batchName": "january_2025_payroll",
    "organizationId": "507f1f77bcf86cd799439011",
    "recipients": [...],
    "totalAmount": "5000000000",
    "quorumRequired": 1,
    "status": "pending",
    "approvalCount": 0,
    "submittedAt": "2025-01-15T...",
    "expiresAt": "2025-02-14T..."
  },
  "message": "Batch payroll recorded successfully"
}
```

---

### **TEST 18: Get Batches for Organization**

**Method:** `GET`  
**URL:** `http://localhost:5000/api/payroll/organizations/507f1f77bcf86cd799439011/batches?status=pending`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Query Parameters (optional):**
- `status`: Filter by status (pending, approved, executed, cancelled, expired)

---

### **TEST 19: Get Batch Details**

**Method:** `GET`  
**URL:** `http://localhost:5000/api/payroll/batches/january_2025_payroll`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
```

---

### **TEST 20: Approve Batch**

**Method:** `POST`  
**URL:** `http://localhost:5000/api/payroll/batches/january_2025_payroll/approve`

**Headers:**
```
Authorization: Bearer YOUR_SIGNER_TOKEN
Content-Type: application/json
```

**Body:**
```json
{
  "signerAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
  "signerName": "John Doe"
}
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "batchName": "january_2025_payroll",
    "approvalCount": 1,
    "status": "approved",
    "approvals": [
      {
        "signerAddress": "0x742d35cc6634c0532925a3b844bc9e7595f0beb1",
        "signerName": "John Doe",
        "approvedAt": "2025-01-15T..."
      }
    ]
  },
  "message": "Batch approval recorded successfully"
}
```

---

### **TEST 21: Execute Batch**

**Method:** `POST`  
**URL:** `http://localhost:5000/api/payroll/batches/january_2025_payroll/execute`

**Headers:**
```
Authorization: Bearer YOUR_SIGNER_TOKEN
Content-Type: application/json
```

**Body:**
```json
{
  "executorAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
  "txHash": "0xdef456abc789def456abc789def456abc789def456abc789def456abc789def456"
}
```

---

### **TEST 22: Search User by Username** 🔍

**Method:** `GET`  
**URL:** `http://localhost:5000/api/users/search/johnson_alice_987654`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "username": "johnson_alice_987654",
      "fullName": "Alice Johnson",
      "walletAddress": "0x9876543210fedcba9876543210fedcba98765432",
      "email": "alice@example.com",
      "isAlreadySigner": false,
      "currentOrganization": "tech-innovations-ltd"
    },
    "canBeAdded": true
  }
}
```

---

### **TEST 23: Suggest Usernames** 💡

**Method:** `GET`  
**URL:** `http://localhost:5000/api/users/suggest?query=john`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "suggestions": [
      {
        "username": "johnson_alice_987654",
        "fullName": "Alice Johnson",
        "avatar": "..."
      },
      {
        "username": "doe_john_742d35",
        "fullName": "John Doe",
        "avatar": "..."
      }
    ]
  }
}
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
GET    /organizations/creator/:address          - Get org by creator
GET    /organizations/slug/:slug                - Get org by slug
GET    /organizations/:id                       - Get org by ID
POST   /organizations/:id/employees             - Add employee
GET    /organizations/:id/employees             - Get all employees
PATCH  /organizations/:id/employees/:username   - Update employee
DELETE /organizations/:id/employees/:username   - Remove employee
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

1. **Save important values in a text file:**
   ```
   Signer Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   Organization ID: 507f1f77bcf86cd799439011
   Wallet Address: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1
   Employee Username: johnson_alice_987654
   ```

2. **Save Requests:**
   After creating each request, click "Save" to reuse later

3. **Use History:**
   Quickly re-run previous tests from the History tab

4. **Organize by Feature:**
   Group related tests (Auth, Organization, Employee, Payroll)

---

### **Recommended Test Flow**

```
1. Health Check
   ↓
2. Register User (will be Signer)
   ↓
3. Get Profile (verify role is "employee")
   ↓
4. Create Organization (user becomes "signer")
   ↓
5. Re-login to get signer token
   ↓
6. Register Another User (will be Employee)
   ↓
7. Add User as Employee (with job details)
   ↓
8. Get Organization Employees (verify employee added)
   ↓
9. Create Batch Payroll
   ↓
10. Approve Batch
   ↓
11. Execute Batch
```

---

### **Common Issues**

**401 Unauthorized:**
- Check if token is included in headers
- Token might be expired (24h validity)
- If you created an organization, re-login to get signer token

**403 Insufficient Permissions:**
- Verify you're using the signer's token for employee management
- Check user's role with `/auth/me`
- Only signers and admins can add/update/remove employees

**404 Not Found:**
- Verify the endpoint URL
- Check if resource exists (organization ID, username, batch name)
- Ensure MongoDB IDs are valid

**400 Bad Request - Validation Failed:**
- Check request body format
- Ensure all required fields are included
- Validate data types (strings, numbers, arrays)
- For employees: username must exist (user must be registered)

**Error: "User not found":**
- Employee must be registered before adding to organization
- Register the user first with `/auth/register`

---

## 📊 Response Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| 200 | OK | Request successful |
| 201 | Created | Resource created successfully |
| 400 | Bad Request | Invalid request data or validation failed |
| 401 | Unauthorized | Authentication required or token invalid |
| 403 | Forbidden | Insufficient permissions (not signer/admin) |
| 404 | Not Found | Resource not found |
| 500 | Server Error | Internal server error |

---

## 🔐 Security Notes

- Tokens expire after 24 hours
- Always use HTTPS in production
- Never commit tokens or secrets to git
- Rotate tokens regularly
- Only signers/admins can manage employees
- Validate all input data

---

## 📝 Notes on Employee Management

### **Username-Based Addition**
- Employees are added by `username`, not wallet address
- This provides better UX and easier search
- Username is automatically generated during registration

### **Job Details Tracking**
- `jobRole`: Position/title (e.g., "Senior Developer")
- `salary`: In smallest unit (6 decimals)
- `department`: Team or department name
- `employeeId`: Company-specific employee ID
- `joinedAt`: Automatically set when added

### **Employee Lifecycle**
1. User registers → Gets username
2. Signer searches by username
3. Signer adds employee with job details
4. Employee can be updated (salary, role)
5. Employee can be removed (returns to regular employee role)

---

**Happy Testing! 🎉**