import { Router } from "express";
import { UserController } from "../controllers/user.controller";
import { authenticate, optionalAuth } from "../middlewares/auth.middleware";
import {
  validate,
  ValidationRules,
} from "../middlewares/validation.middleware";
import { param, query, body } from "express-validator";

const router = Router();

// Search user by username
router.get(
  "/search/:username",
  authenticate,
  validate([
    param("username")
      .trim()
      .isLength({ min: 3 })
      .withMessage("Username must be at least 3 characters"),
  ]),
  UserController.searchByUsername
);

// Auto-suggest usernames
router.get(
  "/suggest",
  authenticate,
  validate([
    query("query")
      .optional()
      .trim()
      .isLength({ min: 2 })
      .withMessage("Query must be at least 2 characters"),
  ]),
  UserController.suggestUsernames
);

// Batch lookup
router.post(
  "/batch-lookup",
  authenticate,
  validate([
    body("usernames")
      .isArray({ min: 1, max: 20 })
      .withMessage("Usernames must be an array with 1-20 items"),
  ]),
  UserController.batchLookup
);

export default router;