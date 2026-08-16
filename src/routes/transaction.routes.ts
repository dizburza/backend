import { Router } from "express";
import { TransactionController } from "../controllers/transaction.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { requireAddressAccess } from "../middlewares/membership.middleware.js";
import {
  validate,
  ValidationRules,
} from "../middlewares/validation.middleware.js";
import { transactionLimiter } from "../middlewares/rateLimiter.middleware.js";
import { RealtimeController } from "../controllers/realtime.controller.js";
import { body, param } from "express-validator";
import { ValidationUtil } from "../utils/validation.util.js";

const router = Router();

// Get aggregated transaction totals (fast)
router.get(
  "/:address/summary",
  authenticate,
  requireAddressAccess,
  validate([
    param("address").custom(ValidationUtil.isValidAddress).withMessage("Invalid wallet address"),
  ]),
  TransactionController.getSummary
);

// Get bucketed inflow/outflow series for charts
router.get(
  "/:address/chart",
  authenticate,
  requireAddressAccess,
  validate([
    param("address").custom(ValidationUtil.isValidAddress).withMessage("Invalid wallet address"),
  ]),
  TransactionController.getChart
);

// Get transaction history
router.get(
  "/:address",
  authenticate,
  requireAddressAccess,
  validate([
    param("address")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
    ...ValidationRules.pagination,
  ]),
  TransactionController.getHistory
);

// Hand a just-submitted transaction to the backend to confirm server-side, so
// the browser doesn't hold a polling loop open behind a blocking overlay.
router.post(
  "/watch",
  authenticate,
  transactionLimiter,
  validate([
    body("txHash")
      .matches(/^0x[0-9a-fA-F]{64}$/)
      .withMessage("A valid 32-byte transaction hash is required"),
  ]),
  RealtimeController.watchTransaction
);

// Body is a txHash only. The server reads amounts and addresses back from the
// chain rather than trusting the client. Purely an optimisation, since the
// indexer catches everything anyway.
router.post(
  "/record",
  authenticate,
  transactionLimiter,
  validate(ValidationRules.recordTransaction),
  TransactionController.recordTransaction
);

export default router;
