import { Request, Response, NextFunction } from "express";
import { validationResult, ValidationChain } from "express-validator";
import { ApiResponse } from "../utils/response.util";

export const validate = (validations: ValidationChain[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await Promise.all(validations.map((validation) => validation.run(req)));

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      ApiResponse.error(res, "Validation failed", 400, errors.array());
      return;
    }

    next();
  };
};

// Common validation rules
import { body, param, query } from "express-validator";
import { ValidationUtil } from "../utils/validation.util";

export const ValidationRules = {
  // Address validation
  walletAddress: param("address")
    .custom(ValidationUtil.isValidAddress)
    .withMessage("Invalid wallet address"),

  // Registration validation
  register: [
    body("walletAddress")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
    body("username")
      .trim()
      .optional({ values: "falsy" })
      .isLength({ min: 3, max: 30 })
      .withMessage("Username must be 3-30 characters")
      .matches(/^[a-zA-Z0-9_]+$/)
      .withMessage(
        "Username can only contain letters, numbers, and underscores"
      ),
    body("surname")
      .trim()
      .notEmpty()
      .withMessage("Surname is required")
      .isLength({ min: 2, max: 50 })
      .withMessage("Surname must be 2-50 characters"),
    body("firstname")
      .trim()
      .notEmpty()
      .withMessage("Firstname is required")
      .isLength({ min: 2, max: 50 })
      .withMessage("Firstname must be 2-50 characters"),
    body("fullName")
      .trim()
      .optional({ values: "falsy" })
      .isLength({ min: 4, max: 100 })
      .withMessage("Full name must be 4-100 characters"),
    body("email")
      .notEmpty()
      .withMessage("Email is required")
      .isEmail()
      .withMessage("Invalid email address")
      .normalizeEmail(),
    body("phoneNumber")
      .optional({ values: "falsy" })
      .isMobilePhone("any")
      .withMessage("Invalid phone number"),
    body("avatar").optional().isURL().withMessage("Avatar must be a valid URL"),
    body("role")
      .optional({ values: "falsy" })
      .isIn(["employee", "signer", "admin"])
      .withMessage("Invalid role"),
  ],

  // Create organization validation
  createOrganization: [
    body("name")
      .trim()
      .notEmpty()
      .withMessage("Organization name is required")
      .isLength({ min: 3, max: 100 })
      .withMessage("Organization name must be 3-100 characters"),
    body("contractAddress")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid contract address"),
    body("businessEmail")
      .notEmpty()
      .withMessage("Business email is required")
      .isEmail()
      .withMessage("Invalid business email")
      .normalizeEmail(),
    body("businessInfo.registrationNumber").optional().trim(),
    body("businessInfo.registrationType")
      .optional()
      .isIn([
        "Sole Proprietorship",
        "Partnership",
        "Limited Liability Company (Ltd)",
        "Public Limited Company (PLC)",
        "Nonprofit / NGO",
        "Cooperative",
        "Government Owned",
        "Business Name",
      ])
      .withMessage("Invalid registration type"),
    body("signers")
      .isArray({ min: 1 })
      .withMessage("At least one signer is required"),
    body("signers.*.address")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid signer address"),
    body("signers.*.name")
      .trim()
      .notEmpty()
      .withMessage("Signer name is required"),
    body("signers.*.role")
      .trim()
      .notEmpty()
      .withMessage("Signer role is required"),
    body("quorum").isInt({ min: 1 }).withMessage("Quorum must be at least 1"),
    body("metadata.industry")
      .optional()
      .isIn([
        "Information Technology",
        "Finance",
        "Healthcare",
        "Agriculture",
        "Education",
        "Media",
        "Industrial Services",
        "Transportation",
        "Tourism",
        "Legal Services",
        "Life Sciences",
        "Manufacturing",
        "Entertainment",
        "Hospitality",
        "Social Impact",
        "Logistics",
      ])
      .withMessage("Invalid industry"),
    body("metadata.size")
      .optional()
      .isIn(["1-10", "11-50", "51-200", "201-500", "501+"])
      .withMessage("Invalid company size"),
    body("metadata.description")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Description must be less than 500 characters"),
  ],

  // Login validation
  login: [
    body("walletAddress")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
    body("signature").notEmpty().withMessage("Signature is required"),
    body("message").notEmpty().withMessage("Message is required"),
  ],

  // Transaction validation
  recordTransaction: [
    body("txHash").notEmpty().withMessage("Transaction hash is required"),
    body("type")
      .isIn([
        "send",
        "receive",
        "payroll",
        "qr_payment",
        "bank_transfer",
        "airtime",
        "bills",
      ])
      .withMessage("Invalid transaction type"),
    body("fromAddress")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid from address"),
    body("toAddress")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid to address"),
    body("amount")
      .custom(ValidationUtil.isPositiveAmount)
      .withMessage("Amount must be a positive number"),
  ],

  // Batch payroll validation
  createBatch: [
    body("batchName")
      .custom(ValidationUtil.isValidBatchName)
      .withMessage("Invalid batch name"),
    body("organizationId").isMongoId().withMessage("Invalid organization ID"),
    body("recipients")
      .isArray({ min: 1, max: 100 })
      .withMessage("Recipients must be an array with 1-100 items"),
    body("recipients.*.walletAddress")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid recipient address"),
    body("recipients.*.amount")
      .custom(ValidationUtil.isPositiveAmount)
      .withMessage("Invalid recipient amount"),
    body("recipients.*.employeeName") // ✅ Add this
      .trim()
      .notEmpty()
      .withMessage("Employee name is required")
      .isLength({ min: 2, max: 100 })
      .withMessage("Employee name must be 2-100 characters"),
    body("totalAmount")
      .custom(ValidationUtil.isPositiveAmount)
      .withMessage("Invalid total amount"),
    body("quorumRequired")
      .isInt({ min: 1 })
      .withMessage("Quorum must be at least 1"),
    body("submittedAt").isISO8601().withMessage("Invalid submitted date"),
    body("expiresAt").isISO8601().withMessage("Invalid expiration date"),
  ],

  // Query pagination
  pagination: [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("Limit must be between 1 and 100"),
  ],
};