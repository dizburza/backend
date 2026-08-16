import { Router } from "express";
import { param } from "express-validator";
import { RealtimeController } from "../controllers/realtime.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { requireAddressAccess } from "../middlewares/membership.middleware.js";
import { validate } from "../middlewares/validation.middleware.js";
import { ValidationUtil } from "../utils/validation.util.js";

const router = Router();

// Cached balance, read from Postgres rather than the chain.
router.get(
  "/:address",
  authenticate,
  requireAddressAccess,
  validate([
    param("address")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
  ]),
  RealtimeController.getBalance
);

export default router;
