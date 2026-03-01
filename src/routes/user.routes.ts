import { Router } from "express";
import { UserController } from "../controllers/user.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validation.middleware.js";
import { param, query, body } from "express-validator";
import { ValidationUtil } from "../utils/validation.util.js";

const router = Router();

// Public resolve username -> wallet address
router.get(
  "/resolve/:username",
  validate([
    param("username")
      .trim()
      .isLength({ min: 3 })
      .withMessage("Username must be at least 3 characters"),
  ]),
  UserController.resolveUsername
);

// Public resolve wallet addresses -> usernames
router.post(
  "/resolve-addresses",
  validate([
    body("addresses")
      .isArray({ min: 1, max: 50 })
      .withMessage("Addresses must be an array with 1-50 items"),
  ]),
  UserController.resolveAddresses
);

// Search user by username
router.get(
  "/search/:username",
  validate([
    param("username")
      .trim()
      .isLength({ min: 3 })
      .withMessage("Username must be at least 3 characters"),
  ]),
  UserController.searchByUsername
);

// Search user by wallet address
router.get(
  "/search-address/:address",
  validate([
    param("address")
      .trim()
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
  ]),
  UserController.searchByAddress
);

// Auto-suggest usernames
router.get(
  "/suggest",
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