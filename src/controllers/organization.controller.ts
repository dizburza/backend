import { Request, Response } from "express";
import { PayrollService } from "../services/payroll.service.js";
import { OrganizationService } from "../services/organization.service.js";
import { MembershipService } from "../services/membership.service.js";
import { ApiResponse } from "../utils/response.util.js";
import { asyncHandler } from "../middlewares/errorHandler.middleware.js";

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

  /**
   * GET /api/organizations/:id/employees/template
   * Download CSV template for employee bulk upload
   */
  static readonly downloadEmployeeTemplate = asyncHandler(async (_req: Request, res: Response) => {
    const csvTemplate = PayrollService.generateEmployeeCSVTemplate();
    
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="employee-template.csv"');
    res.send(csvTemplate);
  });

  /**
   * POST /api/organizations/:id/employees/bulk
   * Bulk upload employees from CSV
   */
  static readonly bulkAddEmployees = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params as any;
    const idParam = Array.isArray(id) ? id[0] : id;
    const { csvData } = req.body;

    if (!csvData || typeof csvData !== "string") {
      ApiResponse.error(res, "CSV data is required", 400);
      return;
    }

    try {
      const results = await PayrollService.bulkAddEmployees(idParam, csvData);
      ApiResponse.success(res, results, `Added ${results.added} employees. ${results.errors.length} errors.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to process CSV";
      if (message.includes("Missing required fields") || message.includes("Invalid CSV")) {
        ApiResponse.error(res, message, 400);
      } else {
        throw error;
      }
    }
  });

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
}
