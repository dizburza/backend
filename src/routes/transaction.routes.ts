import { Router } from "express";
import { TransactionController } from "../controllers/transaction.controller";
import { authenticate, optionalAuth } from "../middlewares/auth.middleware";
import {
  validate,
  ValidationRules,
} from "../middlewares/validation.middleware";
import { transactionLimiter } from "../middlewares/rateLimiter.middleware";
import { param } from "express-validator";
import { ValidationUtil } from "../utils/validation.util";

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
