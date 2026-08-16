import { Router } from "express";
import { PayrollController } from "../controllers/payroll.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  requireBatchSigner,
  requireOrganizationSigner,
} from "../middlewares/membership.middleware.js";
import {
  validate,
  ValidationRules,
} from "../middlewares/validation.middleware.js";
import { param } from "express-validator";

const router = Router();

// Create batch
router.post(
  "/batches",
  authenticate,
  requireOrganizationSigner,
  validate(ValidationRules.createBatch),
  PayrollController.recordBatchCreation
);

// Approve batch
router.post(
  "/batches/:batchName/approve",
  authenticate,
  requireBatchSigner,
  validate([
    param("batchName").trim().notEmpty().withMessage("Batch name is required"),
  ]),
  PayrollController.recordBatchApproval
);

// Revoke batch approval
router.post(
  "/batches/:batchName/revoke",
  authenticate,
  requireBatchSigner,
  validate([
    param("batchName").trim().notEmpty().withMessage("Batch name is required"),
  ]),
  PayrollController.recordBatchApprovalRevocation
);

// Execute batch
router.post(
  "/batches/:batchName/execute",
  authenticate,
  requireBatchSigner,
  validate([
    param("batchName").trim().notEmpty().withMessage("Batch name is required"),
  ]),
  PayrollController.recordBatchExecution
);

// Cancel batch
router.post(
  "/batches/:batchName/cancel",
  authenticate,
  requireBatchSigner,
  validate([
    param("batchName").trim().notEmpty().withMessage("Batch name is required"),
  ]),
  PayrollController.recordBatchCancellation
);

// Get batches for organization
router.get(
  "/organizations/:id/batches",
  authenticate,
  requireOrganizationSigner,
  validate([param("id").isUUID().withMessage("Invalid organization ID")]),
  PayrollController.getBatches
);

// Get batch by name
router.get(
  "/batches/:batchName",
  authenticate,
  requireBatchSigner,
  validate([
    param("batchName").trim().notEmpty().withMessage("Batch name is required"),
  ]),
  PayrollController.getBatchByName
);

export default router;