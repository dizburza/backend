import { Router } from "express";
import { UserController } from "../controllers/user.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { lookupLimiter } from "../middlewares/rateLimiter.middleware.js";
import { validate } from "../middlewares/validation.middleware.js";
import { param, body } from "express-validator";
import { ValidationUtil } from "../utils/validation.util.js";

const router = Router();

/**
 * Every route here is a directory lookup, so all of them are authenticated,
 * exact match and rate limited.
 *
 * They used to be open to the internet. Anyone could walk the user base two
 * characters at a time and come away with real names and wallet addresses, and
 * since the chain is public an address is a person's whole balance and salary
 * history. There is deliberately no prefix search and no suggestion endpoint:
 * you look someone up by typing their username in full.
 */

// Username -> wallet address, for paying someone by @username
router.get(
  "/resolve/:username",
  authenticate,
  lookupLimiter,
  validate([
    param("username")
      .trim()
      .isLength({ min: 3 })
      .withMessage("Username must be at least 3 characters"),
  ]),
  UserController.resolveUsername
);

router.get(
  "/search/:username",
  authenticate,
  lookupLimiter,
  validate([
    param("username")
      .trim()
      .isLength({ min: 3 })
      .withMessage("Username must be at least 3 characters"),
  ]),
  UserController.searchByUsername
);

router.get(
  "/search-address/:address",
  authenticate,
  lookupLimiter,
  validate([
    param("address")
      .trim()
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
  ]),
  UserController.searchByAddress
);

// Confirming a list of usernames pasted into the signer or employee flows
router.post(
  "/batch-lookup",
  authenticate,
  lookupLimiter,
  validate([
    body("usernames")
      .isArray({ min: 1, max: 20 })
      .withMessage("Usernames must be an array with 1-20 items"),
  ]),
  UserController.batchLookup
);

export default router;
