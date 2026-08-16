import { Router } from "express";
import { body, param, query } from "express-validator";
import { CashLinkController } from "../controllers/cashlink.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validation.middleware.js";
import { transactionLimiter } from "../middlewares/rateLimiter.middleware.js";
import { ValidationUtil } from "../utils/validation.util.js";

const router = Router();

/**
 * Send by link.
 *
 * One route here is unauthenticated, and that is the whole point of the
 * feature: a claimer has no account when they open the link. It answers with
 * amount, expiry and state, and nothing that identifies the sender. The claim
 * address is a random 20 bytes, so there is nothing to enumerate.
 */

router.get("/config", CashLinkController.config);

router.get(
  "/quote",
  authenticate,
  validate([query("amount").isString().withMessage("amount is required")]),
  CashLinkController.quote
);

router.get("/", authenticate, CashLinkController.list);

router.post(
  "/",
  authenticate,
  transactionLimiter,
  validate([
    body("claimAddress")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid claim address"),
    body("txHash").matches(/^0x[0-9a-fA-F]{64}$/).withMessage("Invalid transaction hash"),
    body("description")
      .optional({ nullable: true })
      .isLength({ max: 200 })
      .withMessage("Description is too long"),
  ]),
  CashLinkController.record
);

// Deliberately last among the GETs, so /config and /quote are not read as an
// address.
router.get(
  "/:claimAddress",
  validate([
    param("claimAddress")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid claim address"),
  ]),
  CashLinkController.publicView
);

router.post(
  "/:claimAddress/claim",
  authenticate,
  transactionLimiter,
  validate([
    param("claimAddress")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid claim address"),
    body("signature")
      .matches(/^0x[0-9a-fA-F]{130}$/)
      .withMessage("signature must be 65 bytes"),
  ]),
  CashLinkController.claim
);

router.post(
  "/:claimAddress/cancelled",
  authenticate,
  validate([
    param("claimAddress")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid claim address"),
    body("txHash").matches(/^0x[0-9a-fA-F]{64}$/).withMessage("Invalid transaction hash"),
  ]),
  CashLinkController.markCancelled
);

export default router;
