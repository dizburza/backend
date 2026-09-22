import { Request, Response, NextFunction } from "express";
import {
  validationResult,
  ValidationChain,
  body,
  param,
  query,
} from "express-validator";
import { ApiResponse } from "../utils/response.util.js";
import { ValidationUtil } from "../utils/validation.util.js";
import { REGISTRATION_TYPES } from "../types/payroll.types.js";

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

export const ValidationRules = {
  // Address validation
  walletAddress: param("address")
    .custom(ValidationUtil.isValidAddress)
    .withMessage("Invalid wallet address"),

  // Registration validation
  updateProfile: [
    body("surname")
      .optional()
      .trim()
      .isLength({ min: 1, max: 60 })
      .withMessage("Surname must be 1-60 characters"),
    body("firstname")
      .optional()
      .trim()
      .isLength({ min: 1, max: 60 })
      .withMessage("First name must be 1-60 characters"),
    body("email").optional().trim().isEmail().withMessage("Invalid email"),
    body("phoneNumber")
      .optional()
      .trim()
      .isLength({ min: 7, max: 20 })
      .withMessage("Phone number must be 7-20 characters"),
    body("username")
      .optional()
      .trim()
      .isLength({ min: 3, max: 40 })
      .withMessage("Username must be 3-40 characters")
      .matches(/^[a-z0-9_]+$/i)
      .withMessage("Username may only contain letters, numbers and underscores"),
  ],

  register: [
    body("walletAddress")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
    body("signature")
      .matches(/^0x[0-9a-fA-F]+$/)
      .withMessage("A wallet signature is required"),
    body("username")
      .trim()
      .optional({ values: "falsy" })
      .isLength({ min: 3, max: 30 })
      .withMessage("Username must be 3-30 characters")
      .matches(/^\w+$/)
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
    // No `role` here on purpose. It used to be accepted from the request body
    // and written straight to users.role, which authorization then read, so
    // registering with "admin" was self-service privilege escalation. What a
    // person may do comes from organization_members, never from what they
    // claimed when signing up.
  ],

  // Create organization validation
  createOrganization: [
    body("name")
      .trim()
      .notEmpty()
      .withMessage("Organization name is required")
      .isLength({ min: 3, max: 100 })
      .withMessage("Organization name must be 3-100 characters"),
    body("organizationHash")
      .optional({ values: "falsy" })
      .isString()
      .trim()
      .notEmpty()
      .withMessage("organizationHash must be a non-empty string"),
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
    body("businessInfo.taxIdentificationNumber")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ max: 32 })
      .withMessage("Tax identification number must be less than 32 characters"),
    body("businessInfo.registrationType")
      .optional()
      .isIn(REGISTRATION_TYPES)
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
    // Only present when the creator said they are on the payroll, and then
    // both terms are required: a membership with no salary is not employment.
    body("creatorEmployment.jobRole")
      .optional()
      .trim()
      .notEmpty()
      .withMessage("Job role is required to be added to the payroll"),
    body("creatorEmployment.salary")
      .optional()
      .isFloat({ gt: 0 })
      .withMessage("Salary must be greater than zero"),
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

  // Add employee
  addEmployee: [
    param("id").isUUID().withMessage("Invalid organization ID"),
    body("username")
      .trim()
      .optional({ values: "falsy" })
      .isLength({ min: 3, max: 30 })
      .withMessage("Username must be 3-30 characters"),
    body("walletAddress")
      .optional({ values: "falsy" })
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
    body("surname")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage("Surname must be 2-50 characters"),
    body("firstname")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage("Firstname must be 2-50 characters"),
    body().custom((value) => {
      const hasUsername = Boolean((value?.username || "").trim());
      if (hasUsername) return true;

      const wallet = (value?.walletAddress || "").trim();
      const surname = (value?.surname || "").trim();
      const firstname = (value?.firstname || "").trim();

      if (!wallet || !surname || !firstname) {
        throw new Error(
          "Either username must be provided, or walletAddress + surname + firstname are required"
        );
      }

      return true;
    }),
    body("jobRole")
      .trim()
      .notEmpty()
      .withMessage("Job role is required")
      .isLength({ min: 2, max: 100 })
      .withMessage("Job role must be 2-100 characters"),
    body("salary")
      .notEmpty()
      .withMessage("Salary is required")
      .custom(ValidationUtil.isPositiveAmount)
      .withMessage("Salary must be a positive number"),
    body("department")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ max: 100 })
      .withMessage("Department must be less than 100 characters"),
    body("employeeId")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ max: 50 })
      .withMessage("Employee ID must be less than 50 characters"),
  ],

  // Update employee
  updateEmployee: [
    param("id").isUUID().withMessage("Invalid organization ID"),
    param("username").trim().notEmpty().withMessage("Username is required"),
    body("jobRole")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage("Job role must be 2-100 characters"),
    body("salary")
      .optional({ values: "falsy" })
      .custom(ValidationUtil.isPositiveAmount)
      .withMessage("Salary must be a positive number"),
  ],

  // Delete employee
  deleteEmployee: [
    param("id").isUUID().withMessage("Invalid organization ID"),
    param("username").trim().notEmpty().withMessage("Username is required"),
  ],

  // Login validation
  login: [
    body("walletAddress")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
    body("signature")
      .matches(/^0x[0-9a-fA-F]+$/)
      .withMessage("A wallet signature is required"),
  ],

  // Transaction validation
  // Only a txHash is accepted. Addresses, amounts and transfer direction are
  // decoded from the on-chain receipt, so a caller cannot assert a transfer
  // that never happened or inflate one that did.
  recordTransaction: [
    body("txHash")
      .matches(/^0x[0-9a-fA-F]{64}$/)
      .withMessage("A valid 32-byte transaction hash is required"),
    body("description").optional().isString().isLength({ max: 500 }),
    body("memo").optional().isString().isLength({ max: 500 }),
    body("category")
      .optional()
      .isIn([
        "salary",
        "food",
        "transport",
        "utilities",
        "entertainment",
        "shopping",
        "health",
        "other",
      ])
      .withMessage("Invalid category"),
  ],

  // Batch payroll validation
  createBatch: [
    body("batchName")
      .custom(ValidationUtil.isValidBatchName)
      .withMessage("Invalid batch name"),
    body("organizationId").isUUID().withMessage("Invalid organization ID"),
    body("organizationAddress")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid organization address"),
    body("creatorAddress")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid creator address"),
    body("recipients")
      .isArray({ min: 1, max: 100 })
      .withMessage("Recipients must be an array with 1-100 items"),
    body("recipients.*.walletAddress")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid recipient address"),
    body("recipients.*.amount")
      .custom(ValidationUtil.isPositiveAmount)
      .withMessage("Invalid recipient amount"),
    body("recipients.*.employeeName")
      .trim()
      .notEmpty()
      .withMessage("Employee name is required")
      .isLength({ min: 2, max: 100 })
      .withMessage("Employee name must be 2-100 characters"),
    body("proposalId").optional({ values: "null" }).isUUID().withMessage("Invalid proposal ID"),
    body("txHash")
      .optional({ values: "falsy" })
      .isString()
      .withMessage("Transaction hash must be a string"),
    body("blockNumber")
      .optional({ values: "falsy" })
      .isInt()
      .withMessage("Block number must be an integer"),
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

  sendEmailVerification: [
    body("email").trim().isEmail().withMessage("A valid email is required").normalizeEmail(),
  ],

  verifyEmailVerification: [
    body("email").trim().isEmail().withMessage("A valid email is required").normalizeEmail(),
    body("code")
      .trim()
      .isLength({ min: 6, max: 6 })
      .withMessage("Code must be 6 digits")
      .isNumeric()
      .withMessage("Code must be 6 digits"),
  ],

  // Signer change proposal validation
  recordSignerChangeProposal: [
    body("proposalId")
      .isString()
      .matches(/^0x[0-9a-fA-F]{64}$/)
      .withMessage("Invalid proposal ID"),
    body("organizationAddress")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid organization address"),
    body("subjectAddress")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid subject address"),
    body("subjectName")
      .trim()
      .notEmpty()
      .withMessage("Subject name is required")
      .isLength({ min: 1, max: 100 })
      .withMessage("Subject name must be 1-100 characters"),
    body("isRemoval").isBoolean().withMessage("isRemoval must be a boolean"),
    body("signerEpoch").isInt({ min: 0 }).withMessage("Invalid signer epoch"),
    body("createdByName")
      .trim()
      .notEmpty()
      .withMessage("createdByName is required")
      .isLength({ min: 1, max: 100 })
      .withMessage("createdByName must be 1-100 characters"),
  ],

  recordSignerChangeApproval: [
    body("signerName")
      .trim()
      .notEmpty()
      .withMessage("Signer name is required")
      .isLength({ min: 1, max: 100 })
      .withMessage("Signer name must be 1-100 characters"),
  ],

  recordSignerChangeExecution: [
    body("txHash")
      .isString()
      .matches(/^0x[0-9a-fA-F]{64}$/)
      .withMessage("Invalid transaction hash"),
  ],
};