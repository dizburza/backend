import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import {
  ValidationRules,
  validate,
} from "../middlewares/validation.middleware";
import { authLimiter } from "../middlewares/rateLimiter.middleware";
import { authenticate } from "../middlewares/auth.middleware";

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
