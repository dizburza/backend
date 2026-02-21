import { Router } from "express";
import { AuthController } from "../controllers/auth.controller.js";
import {
  ValidationRules,
  validate,
} from "../middlewares/validation.middleware.js";
import { authLimiter } from "../middlewares/rateLimiter.middleware.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const router = Router();

router.post(
  "/register",
  authLimiter,
  validate(ValidationRules.register),
  AuthController.register
);

router.post(
  "/login",
  authLimiter,
  validate(ValidationRules.login),
  AuthController.login
);

router.get("/check/:address", AuthController.checkStatus);
router.get("/message/:address", AuthController.getAuthMessage);
router.get("/me", authenticate, AuthController.getProfile);

export default router;
