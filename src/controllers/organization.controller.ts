import { Request, Response } from "express";
import { PayrollService } from "../services/payroll.service.js";
import { OrganizationService } from "../services/organization.service.js";
import { MembershipService } from "../services/membership.service.js";
import { EmailVerificationService } from "../services/email-verification.service.js";
import { EmployeeInviteService } from "../services/employee-invite.service.js";
import { ApiResponse } from "../utils/response.util.js";
import { AppError, asyncHandler } from "../middlewares/errorHandler.middleware.js";

export class OrganizationController {
  /**
   * POST /api/organizations
   * Record organization creation after frontend calls smart contract
   */
  static readonly createOrganization = asyncHandler(
    async (req: Request, res: Response) => {
      const {
        name,
        contractAddress,
        organizationHash,
        creatorAddress,
        businessEmail,
        businessInfo,
        signers,
        quorum,
        metadata,
        settings,
      } = req.body;

      const organization = await PayrollService.createOrganization({
        name,
        contractAddress,
        organizationHash,
        creatorAddress,
        businessEmail,
        businessInfo,
        signers,
        quorum,
        metadata,
        settings,
      });

      ApiResponse.created(
        res,
        organization,
        "Organization created successfully"
      );
    }
  );

  /**
   * GET /api/organizations/identifiers/available
   * Whether a registration number or TIN is still unclaimed
   */
  static readonly checkIdentifiers = asyncHandler(
    async (req: Request, res: Response) => {
      const first = (value: unknown): string | undefined => {
        if (Array.isArray(value)) return value[0] as string | undefined;
        return typeof value === "string" ? value : undefined;
      };

      const availability = await PayrollService.checkIdentifiers({
        registrationNumber: first(req.query.registrationNumber),
        taxIdentificationNumber: first(req.query.taxIdentificationNumber),
      });

      ApiResponse.success(res, availability);
    }
  );

  /**
   * GET /api/organizations/signer/:address
   * Organizations this address signs for, which may be more than one
   */
  static readonly getSignerOrganizations = asyncHandler(
    async (req: Request, res: Response) => {
      const { address } = req.params as any;
      const addressParam = Array.isArray(address) ? address[0] : address;

      const organizations = await PayrollService.getOrganizationsForSigner(
        addressParam
      );

      ApiResponse.success(res, { organizations, total: organizations.length });
    }
  );

  /**
   * GET /api/organizations/slug/:slug
   *
   * The dashboard resolves a slug here, so it returns the full record to
   * signers only. It used to be unauthenticated and returned everything: the
   * whole staff roster with wallet addresses, the business email, the
   * registration number and the TIN. Slugs are guessable and `GET
   * /organizations` listed them all, so that was the entire platform.
   *
   * Non-members get the public face of an organization and nothing about the
   * people in it.
   */
  static readonly getBySlug = asyncHandler(async (req: Request, res: Response) => {
    const { slug } = req.params as any;
    const slugParam = Array.isArray(slug) ? slug[0] : slug;

    const organization = await PayrollService.getOrganizationBySlug(slugParam);

    if (!organization) {
      ApiResponse.error(res, "Organization not found", 404);
      return;
    }

    const isSigner =
      req.user !== undefined &&
      (await MembershipService.isSignerOf(organization.id, req.user.walletAddress));

    if (!isSigner) {
      const { id, name, slug: orgSlug, contractAddress, isActive } = organization;
      ApiResponse.success(res, { id, name, slug: orgSlug, contractAddress, isActive });
      return;
    }

    ApiResponse.success(res, organization);
  });

  /**
   * POST /api/organizations/:id/employees
   * Add employee to organization
   */
  static readonly addEmployee = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as any;
    const idParam = Array.isArray(id) ? id[0] : id;
    const { username, walletAddress, surname, firstname, jobRole, salary, department, employeeId } = req.body;

    const performedBy = req.user
      ? {
          userId: req.user.id,
          username: req.user.username,
          walletAddress: req.user.walletAddress,
        }
      : undefined;

    const user = await PayrollService.addEmployee(idParam, {
      username,
      walletAddress,
      surname,
      firstname,
      jobRole,
      salary,
      department,
      employeeId,
    }, performedBy);

    ApiResponse.success(res, user, "Employee added successfully");
  });

  /**
   * GET /api/organizations/:id/employees
   * Get all employees in organization
   */
  static readonly getEmployees = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as any;
    const idParam = Array.isArray(id) ? id[0] : id;

    const result = await PayrollService.getOrganizationEmployees(idParam);

    ApiResponse.success(res, result);
  });

  /**
   * PATCH /api/organizations/:id/employees/:username
   * Update employee details
   */
  static readonly updateEmployee = asyncHandler(async (req: Request, res: Response) => {
    const { id, username } = req.params as any;
    const idParam = Array.isArray(id) ? id[0] : id;
    const usernameParam = Array.isArray(username) ? username[0] : username;
    const { jobRole, salary, department, employeeId } = req.body;

    const performedBy = req.user
      ? {
          userId: req.user.id,
          username: req.user.username,
          walletAddress: req.user.walletAddress,
        }
      : undefined;

    const user = await PayrollService.updateEmployee(idParam, usernameParam, {
      jobRole,
      salary,
      department,
      employeeId,
    }, performedBy);

    ApiResponse.success(res, user, "Employee updated successfully");
  });

  /**
   * DELETE /api/organizations/:id/employees/:username
   * Remove employee from organization
   */
  static readonly removeEmployee = asyncHandler(async (req: Request, res: Response) => {
    const { id, username } = req.params as any;
    const idParam = Array.isArray(id) ? id[0] : id;
    const usernameParam = Array.isArray(username) ? username[0] : username;

    const performedBy = req.user
      ? {
          userId: req.user.id,
          username: req.user.username,
          walletAddress: req.user.walletAddress,
        }
      : undefined;

    const user = await PayrollService.removeEmployee(idParam, usernameParam, performedBy);

    ApiResponse.success(res, user, "Employee removed successfully");
  });

  /**
   * GET /api/organizations
   *
   * Organizations the caller signs for, not every organization on the platform.
   *
   * The unfiltered list handed any signed-in user every slug, which made the
   * slug route enumerable rather than merely guessable.
   */
  static readonly getAllOrganizations = asyncHandler(
    async (req: Request, res: Response) => {
      if (!req.user) {
        ApiResponse.error(res, "Authentication required", 401);
        return;
      }

      const organizations = await PayrollService.getOrganizationsForSigner(
        req.user.walletAddress
      );

      ApiResponse.success(res, organizations);
    }
  );

  /**
   * GET /api/organizations/:id
   * Get organization by ID
   */
  static readonly getById = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as any;
    const idParam = Array.isArray(id) ? id[0] : id;

    const organization = await OrganizationService.findById(idParam);

    if (!organization || !organization.isActive) {
      ApiResponse.error(res, "Organization not found", 404);
      return;
    }

    ApiResponse.success(res, organization);
  });

  /** The columns a staff upload is expected to carry. */
  static readonly downloadEmployeeTemplate = asyncHandler(async (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="employee-template.csv"');
    res.send(EmployeeInviteService.csvTemplate());
  });

  /**
   * Says what a batch would do without doing it, so nobody sends twenty
   * invitations to find out that six rows were incomplete.
   */
  static readonly reviewEmployees = asyncHandler(async (req: Request, res: Response) => {
    const organizationId = OrganizationController.idFrom(req);
    const rows = OrganizationController.rowsFrom(req);

    ApiResponse.success(res, await EmployeeInviteService.review(organizationId, rows));
  });

  /**
   * Seeds the memberships and mails the join link.
   *
   * Answers 200 with a per-row account even when some rows failed: one bad
   * line must not discard the rest of the file, so the outcome is data rather
   * than an error code.
   */
  static readonly addEmployees = asyncHandler(async (req: Request, res: Response) => {
    const organizationId = OrganizationController.idFrom(req);
    const rows = OrganizationController.rowsFrom(req);

    const results = await EmployeeInviteService.seed(
      organizationId,
      rows,
      req.user!.walletAddress
    );

    ApiResponse.success(res, results);
  });

  private static idFrom(req: Request): string {
    const { id } = req.params;
    return Array.isArray(id) ? id[0] : id;
  }

  /** Accepts either a parsed list or the raw file, so one route serves both. */
  private static rowsFrom(req: Request) {
    const { employees, csvData } = req.body ?? {};

    if (typeof csvData === "string" && csvData.trim()) {
      return EmployeeInviteService.parseCsv(csvData);
    }

    if (Array.isArray(employees) && employees.length > 0) {
      return employees;
    }

    throw new AppError("Send either a list of employees or a CSV file", 400);
  }

  /**
   * GET /api/organizations/creator/:address
   * Get organization created by address
   */
  static readonly getByCreator = asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params as any;
    const addressParam = Array.isArray(address) ? address[0] : address;

    const organization = await OrganizationService.findByCreator(addressParam);

    if (!organization) {
      ApiResponse.error(res, "Organization not found", 404);
      return;
    }

    ApiResponse.success(res, organization);
  });

  /**
   * POST /api/organizations/email-verification/send
   * Sends a 6-digit code to the business email typed during onboarding
   */
  static readonly sendEmailVerification = asyncHandler(
    async (req: Request, res: Response) => {
      const { email } = req.body;
      await EmailVerificationService.send(email);
      ApiResponse.success(res, null, "Verification code sent");
    }
  );

  /**
   * POST /api/organizations/email-verification/verify
   * Confirms the code sent to the business email
   */
  static readonly verifyEmailVerification = asyncHandler(
    async (req: Request, res: Response) => {
      const { email, code } = req.body;
      await EmailVerificationService.verify(email, code);
      ApiResponse.success(res, null, "Email verified");
    }
  );
}
