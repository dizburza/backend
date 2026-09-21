import { Router } from "express";
import { AuthController } from "../controllers/auth.controller.js";
import {
  ValidationRules,
  validate,
} from "../middlewares/validation.middleware.js";
import { authLimiter, lookupLimiter } from "../middlewares/rateLimiter.middleware.js";
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
router.post("/logout", AuthController.logout);
router.get("/me", authenticate, AuthController.getProfile);

// Onboarding fills these in. The session says whose row is edited, so there is
// no address to pass and none is read.
router.patch(
  "/me",
  authenticate,
  validate(ValidationRules.updateProfile),
  AuthController.updateProfile
);

// Confirms a username exists, so it carries the directory's rate limit.
router.get(
  "/username-available",
  authenticate,
  lookupLimiter,
  AuthController.checkUsername
);

export default router;
