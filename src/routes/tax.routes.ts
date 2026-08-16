import { Router } from "express";
import { param } from "express-validator";
import { TaxController } from "../controllers/tax.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { requireOrganizationSigner } from "../middlewares/membership.middleware.js";
import { validate } from "../middlewares/validation.middleware.js";

const router = Router();

/**
 * A tax line pairs a salary with a name and a wallet address, which is exactly
 * the mapping the directory rate limit exists to protect. Everything here needs
 * a session, and each route is scoped to the person or the employer.
 */

router.get("/me", authenticate, TaxController.myLines);

router.get("/me/statement.pdf", authenticate, TaxController.myStatement);

router.get(
  "/lines/:lineId/receipt.pdf",
  authenticate,
  validate([param("lineId").isUUID().withMessage("Invalid tax line ID")]),
  TaxController.receipt
);

// A batch belongs to an organization, so the signer check reads the path rather
// than the batch, and a batch from another organization simply is not found.
router.get(
  "/organizations/:organizationId/batches/:batchId",
  authenticate,
  validate([
    param("organizationId").isUUID().withMessage("Invalid organization ID"),
    param("batchId").isUUID().withMessage("Invalid batch ID"),
  ]),
  requireOrganizationSigner,
  TaxController.linesForBatch
);

export default router;
