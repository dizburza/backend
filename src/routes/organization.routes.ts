import { Router } from "express";
import { OrganizationController } from "../controllers/organization.controller";
import { authenticate, requireRole } from "../middlewares/auth.middleware";
import {
  validate,
  ValidationRules,
} from "../middlewares/validation.middleware";
import { ValidationUtil } from "../utils/validation.util";
import { param } from "express-validator";

const router = Router();

// Create organization
router.post(
  "/",
  authenticate,
  validate(ValidationRules.createOrganization),
  OrganizationController.createOrganization
);

// Get all organizations
router.get("/", authenticate, OrganizationController.getAllOrganizations);

// Get organization by signer address
router.get(
  "/signer/:address",
  authenticate,
  validate([
    param("address")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
  ]),
  OrganizationController.getSignerOrganization
);

// Get organization by creator address
router.get(
  "/creator/:address",
  authenticate,
  validate([
    param("address")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
  ]),
  OrganizationController.getByCreator
);

// Get organization by slug (public for discovery)
router.get("/slug/:slug", OrganizationController.getBySlug);

// Get organization by ID
router.get(
  "/:id",
  authenticate,
  validate([param("id").isMongoId().withMessage("Invalid organization ID")]),
  OrganizationController.getById
);

// Add employee to organization
router.post(
  "/:id/employees",
  authenticate,
  requireRole("signer", "admin"),
  validate([param("id").isMongoId().withMessage("Invalid organization ID")]),
  OrganizationController.addEmployee
);

export default router;
