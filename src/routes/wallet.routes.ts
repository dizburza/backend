import { Router } from "express";
import { WalletController } from "../controllers/wallet.controller.js";
import { authenticate, optionalAuth } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validation.middleware.js";
import { param } from "express-validator";
import { ValidationUtil } from "../utils/validation.util.js";

const router = Router();

// Get balance (public)
router.get(
  "/:address/balance",
  validate([
    param("address")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
  ]),
  WalletController.getBalance
);

// Get wallet summary
router.get(
  "/:address/summary",
  optionalAuth,
  validate([
    param("address")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
  ]),
  WalletController.getSummary
);

// Sync history
router.post(
  "/:address/sync",
  authenticate,
  validate([
    param("address")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
  ]),
  WalletController.syncHistory
);

export default router;
