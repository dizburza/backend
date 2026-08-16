import { Router } from "express";
import { body, param, query } from "express-validator";
import { ProposalController } from "../controllers/proposal.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validation.middleware.js";

const router = Router();

/**
 * Everything here is authenticated, and the service checks signer membership of
 * the specific organization on top. Being signed in is not enough: proposals
 * are one organization's internal business.
 */

router.post(
  "/",
  authenticate,
  validate([
    body("organizationId").isUUID().withMessage("Invalid organization ID"),
    body("title")
      .trim()
      .isLength({ min: 3, max: 200 })
      .withMessage("Title must be 3-200 characters"),
    body("description")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ max: 5000 })
      .withMessage("Description must be less than 5000 characters"),
    body("amount")
      .optional({ values: "falsy" })
      .matches(/^\d+(\.\d+)?$/)
      .withMessage("Amount must be a positive number"),
    body("closesAt").isISO8601().withMessage("closesAt must be an ISO date"),
  ]),
  ProposalController.create
);

router.get(
  "/organizations/:organizationId",
  authenticate,
  validate([
    param("organizationId").isUUID().withMessage("Invalid organization ID"),
    query("status")
      .optional({ values: "falsy" })
      .isIn(["open", "passed", "rejected", "expired", "cancelled"])
      .withMessage("Invalid status"),
  ]),
  ProposalController.listForOrganization
);

router.get(
  "/:id",
  authenticate,
  validate([param("id").isUUID().withMessage("Invalid proposal ID")]),
  ProposalController.getById
);

router.post(
  "/:id/votes",
  authenticate,
  validate([
    param("id").isUUID().withMessage("Invalid proposal ID"),
    body("choice").isIn(["for", "against"]).withMessage("Vote must be for or against"),
    body("comment")
      .optional({ values: "falsy" })
      .trim()
      .isLength({ max: 1000 })
      .withMessage("Comment must be less than 1000 characters"),
  ]),
  ProposalController.vote
);

router.post(
  "/:id/cancel",
  authenticate,
  validate([param("id").isUUID().withMessage("Invalid proposal ID")]),
  ProposalController.cancel
);

export default router;
