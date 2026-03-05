import { Request, Response } from "express";
import { PayrollService } from "../services/payroll.service.js";
import { Organization } from "../models/Organization.model.js";
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
   * GET /api/organizations/signer/:address
   * Get organization where address is a signer
   */
  static readonly getSignerOrganization = asyncHandler(
    async (req: Request, res: Response) => {
      const { address } = req.params as any;
      const addressParam = Array.isArray(address) ? address[0] : address;

      const organization = await PayrollService.getOrganizationForSigner(
        addressParam
      );

      if (!organization) {
        ApiResponse.error(res, "Organization not found", 404);
        return;
      }

      ApiResponse.success(res, organization);
    }
  );

  /**
   * GET /api/organizations/slug/:slug
   * Get organization by slug (for organization dashboard)
   */
  static readonly getBySlug = asyncHandler(async (req: Request, res: Response) => {
    const { slug } = req.params as any;
    const slugParam = Array.isArray(slug) ? slug[0] : slug;

    const organization = await PayrollService.getOrganizationBySlug(slugParam);

    if (!organization) {
      ApiResponse.error(res, "Organization not found", 404);
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
          userId: req.user._id?.toString(),
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
          userId: req.user._id?.toString(),
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
          userId: req.user._id?.toString(),
          username: req.user.username,
          walletAddress: req.user.walletAddress,
        }
      : undefined;

    const user = await PayrollService.removeEmployee(idParam, usernameParam, performedBy);

    ApiResponse.success(res, user, "Employee removed successfully");
  });

  /**
   * GET /api/organizations
   * Get all organizations (for exploration/discovery)
   */
  static readonly getAllOrganizations = asyncHandler(
    async (_req: Request, res: Response) => {
      const organizations = await PayrollService.getAllOrganizations();
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

    const organization = await Organization.findById(idParam).populate(
      "employees",
      "username fullName walletAddress avatar"
    );

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

    const organization = await Organization.findOne({
      creatorAddress: addressParam.toLowerCase(),
      isActive: true,
    }).populate("employees", "username fullName walletAddress avatar");

    if (!organization) {
      ApiResponse.error(res, "Organization not found", 404);
      return;
    }

    ApiResponse.success(res, organization);
  });
}
