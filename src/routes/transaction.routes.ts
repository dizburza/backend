import { Router } from "express";
import { TransactionController } from "../controllers/transaction.controller.js";
import { authenticate, optionalAuth } from "../middlewares/auth.middleware.js";
import {
  validate,
  ValidationRules,
} from "../middlewares/validation.middleware.js";
import { transactionLimiter } from "../middlewares/rateLimiter.middleware.js";
import { param } from "express-validator";
import { ValidationUtil } from "../utils/validation.util.js";

const router = Router();

// Get transaction history
router.get(
  "/:address",
  optionalAuth,
  validate([
    param("address")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
    ...ValidationRules.pagination,
  ]),
  TransactionController.getHistory
);

// Record transaction (should be authenticated or from blockchain listener)
router.post(
  "/record",
  authenticate,
  transactionLimiter,
  validate(ValidationRules.recordTransaction),
  TransactionController.recordTransaction
);

export default router;
