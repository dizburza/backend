import { Router } from "express";
import { WalletController } from "../controllers/wallet.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { requireAddressAccess } from "../middlewares/membership.middleware.js";
import { validate } from "../middlewares/validation.middleware.js";
import { param } from "express-validator";
import { ValidationUtil } from "../utils/validation.util.js";

const router = Router();

// Get balance
router.get(
  "/:address/balance",
  authenticate,
  requireAddressAccess,
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
  authenticate,
  requireAddressAccess,
  validate([
    param("address")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
  ]),
  WalletController.getSummary
);

export default router;
