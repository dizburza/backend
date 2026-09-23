import { Router } from "express";
import { OrganizationController } from "../controllers/organization.controller.js";
import { InviteController } from "../controllers/invite.controller.js";
import { SignerChangeController } from "../controllers/signer-change.controller.js";
import { authenticate, optionalAuth } from "../middlewares/auth.middleware.js";
import {
  requireAddressAccess,
  requireOrganizationSigner,
} from "../middlewares/membership.middleware.js";
import {
  validate,
  ValidationRules,
} from "../middlewares/validation.middleware.js";
import { emailVerificationLimiter } from "../middlewares/rateLimiter.middleware.js";
import { ValidationUtil } from "../utils/validation.util.js";
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

// Checked while the onboarding form is being filled in
router.get(
  "/identifiers/available",
  authenticate,
  OrganizationController.checkIdentifiers
);

// Business email verification, step 2 of onboarding, before an organization
// row exists to check membership against.
router.post(
  "/email-verification/send",
  authenticate,
  emailVerificationLimiter,
  validate(ValidationRules.sendEmailVerification),
  OrganizationController.sendEmailVerification
);

router.post(
  "/email-verification/verify",
  authenticate,
  emailVerificationLimiter,
  validate(ValidationRules.verifyEmailVerification),
  OrganizationController.verifyEmailVerification
);

// Get organization by signer address
router.get(
  "/signer/:address",
  authenticate,
  requireAddressAccess,
  validate([
    param("address")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
  ]),
  OrganizationController.getSignerOrganizations
);

// Get organization by creator address
router.get(
  "/creator/:address",
  authenticate,
  requireAddressAccess,
  validate([
    param("address")
      .custom(ValidationUtil.isValidAddress)
      .withMessage("Invalid wallet address"),
  ]),
  OrganizationController.getByCreator
);

// Identifiable rather than required: the controller returns a public subset
// to non-members and the full record to signers.
router.get("/slug/:slug", optionalAuth, OrganizationController.getBySlug);

// Get organization by ID
router.get(
  "/:id",
  authenticate,
  requireOrganizationSigner,
  validate([param("id").isUUID().withMessage("Invalid organization ID")]),
  OrganizationController.getById
);

// Employee Management
router.post(
  "/:id/employees",
  authenticate,
  requireOrganizationSigner,
  validate(ValidationRules.addEmployee),
  OrganizationController.addEmployee
);

router.get(
  "/:id/employees",
  authenticate,
  requireOrganizationSigner,
  validate([
    param("id").isUUID().withMessage("Invalid organization ID"),
  ]),
  OrganizationController.getEmployees
);

router.patch(
  "/:id/employees/:username",
  authenticate,
  requireOrganizationSigner,
  validate(ValidationRules.updateEmployee),
  OrganizationController.updateEmployee
);

router.delete(
  "/:id/employees/:username",
  authenticate,
  requireOrganizationSigner,
  validate(ValidationRules.deleteEmployee),
  OrganizationController.removeEmployee
);

router.patch(
  "/:id/employees/:username/reactivate",
  authenticate,
  requireOrganizationSigner,
  validate(ValidationRules.reactivateEmployee),
  OrganizationController.reactivateEmployee
);

// CSV Bulk Upload Routes
router.get(
  "/:id/employees/template",
  authenticate,
  requireOrganizationSigner,
  validate([param("id").isUUID().withMessage("Invalid organization ID")]),
  OrganizationController.downloadEmployeeTemplate
);

// Checking a batch is the same act as adding one, and it reads the roster to
// answer, so it is gated the same way.
router.post(
  "/:id/employees/review",
  authenticate,
  requireOrganizationSigner,
  validate([param("id").isUUID().withMessage("Invalid organization ID")]),
  OrganizationController.reviewEmployees
);

router.post(
  "/:id/employees/batch",
  authenticate,
  requireOrganizationSigner,
  validate([param("id").isUUID().withMessage("Invalid organization ID")]),
  OrganizationController.addEmployees
);

/**
 * The invitation link. Issuing one is a signer's act: it admits people to this
 * organization, so the same gate as the staff roster applies.
 */
const organizationIdParam = [
  param("organizationId").isUUID().withMessage("Invalid organization ID"),
];

router.get(
  "/:organizationId/invite",
  authenticate,
  requireOrganizationSigner,
  validate(organizationIdParam),
  InviteController.current
);

router.post(
  "/:organizationId/invite",
  authenticate,
  requireOrganizationSigner,
  validate(organizationIdParam),
  InviteController.issue
);

router.delete(
  "/:organizationId/invite",
  authenticate,
  requireOrganizationSigner,
  validate(organizationIdParam),
  InviteController.revoke
);

/** Re-sends the live invite link to one person still waiting on it. */
router.post(
  "/:organizationId/employees/:membershipId/remind",
  authenticate,
  requireOrganizationSigner,
  validate([
    param("organizationId").isUUID().withMessage("Invalid organization ID"),
    param("membershipId").isUUID().withMessage("Invalid membership ID"),
  ]),
  InviteController.remind
);

/**
 * Signer changes. The frontend calls proposeSignerChange / approveSignerChange
 * / executeSignerChange on chain first; these routes only record what already
 * happened, the same relationship the batch routes have to the payroll
 * contract calls.
 */
router.get(
  "/:id/signer-changes",
  authenticate,
  requireOrganizationSigner,
  validate([param("id").isUUID().withMessage("Invalid organization ID")]),
  SignerChangeController.list
);

router.post(
  "/:id/signer-changes",
  authenticate,
  requireOrganizationSigner,
  validate([
    param("id").isUUID().withMessage("Invalid organization ID"),
    ...ValidationRules.recordSignerChangeProposal,
  ]),
  SignerChangeController.recordProposal
);

router.post(
  "/:id/signer-changes/:proposalId/approve",
  authenticate,
  requireOrganizationSigner,
  validate([
    param("id").isUUID().withMessage("Invalid organization ID"),
    param("proposalId").matches(/^0x[0-9a-fA-F]{64}$/).withMessage("Invalid proposal ID"),
    ...ValidationRules.recordSignerChangeApproval,
  ]),
  SignerChangeController.recordApproval
);

router.post(
  "/:id/signer-changes/:proposalId/execute",
  authenticate,
  requireOrganizationSigner,
  validate([
    param("id").isUUID().withMessage("Invalid organization ID"),
    param("proposalId").matches(/^0x[0-9a-fA-F]{64}$/).withMessage("Invalid proposal ID"),
    ...ValidationRules.recordSignerChangeExecution,
  ]),
  SignerChangeController.recordExecution
);

export default router;
