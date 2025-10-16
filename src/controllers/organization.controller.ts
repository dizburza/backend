import { Request, Response } from "express";
import { PayrollService } from "../services/payroll.service";
import { Organization } from "../models/Organization.model";
import { ApiResponse } from "../utils/response.util";
import { asyncHandler } from "../middlewares/errorHandler.middleware";

export class OrganizationController {
  /**
   * POST /api/organizations
   * Record organization creation after frontend calls smart contract
   */
  static createOrganization = asyncHandler(
    async (req: Request, res: Response) => {
      const {
        name,
        contractAddress,
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
  static getSignerOrganization = asyncHandler(
    async (req: Request, res: Response) => {
      const { address } = req.params;

      const organization = await PayrollService.getOrganizationForSigner(
        address
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
  static getBySlug = asyncHandler(async (req: Request, res: Response) => {
    const { slug } = req.params;

    const organization = await PayrollService.getOrganizationBySlug(slug);

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
  static addEmployee = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { username, jobRole, salary, department, employeeId } = req.body;

    const user = await PayrollService.addEmployee(id, {
      username,
      jobRole,
      salary,
      department,
      employeeId,
    });

    ApiResponse.success(res, user, "Employee added successfully");
  });

  /**
   * GET /api/organizations/:id/employees
   * Get all employees in organization
   */
  static getEmployees = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const result = await PayrollService.getOrganizationEmployees(id);

    ApiResponse.success(res, result);
  });

  /**
   * PATCH /api/organizations/:id/employees/:username
   * Update employee details
   */
  static updateEmployee = asyncHandler(async (req: Request, res: Response) => {
    const { id, username } = req.params;
    const { jobRole, salary, department, employeeId } = req.body;

    const user = await PayrollService.updateEmployee(id, username, {
      jobRole,
      salary,
      department,
      employeeId,
    });

    ApiResponse.success(res, user, "Employee updated successfully");
  });

  /**
   * DELETE /api/organizations/:id/employees/:username
   * Remove employee from organization
   */
  static removeEmployee = asyncHandler(async (req: Request, res: Response) => {
    const { id, username } = req.params;

    const user = await PayrollService.removeEmployee(id, username);

    ApiResponse.success(res, user, "Employee removed successfully");
  });

  /**
   * GET /api/organizations
   * Get all organizations (for exploration/discovery)
   */
  static getAllOrganizations = asyncHandler(
    async (_req: Request, res: Response) => {
      const organizations = await PayrollService.getAllOrganizations();
      ApiResponse.success(res, organizations);
    }
  );

  /**
   * GET /api/organizations/:id
   * Get organization by ID
   */
  static getById = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const organization = await Organization.findById(id).populate(
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
   * GET /api/organizations/creator/:address
   * Get organization created by address
   */
  static getByCreator = asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params;

    const organization = await Organization.findOne({
      creatorAddress: address.toLowerCase(),
      isActive: true,
    }).populate("employees", "username fullName walletAddress avatar");

    if (!organization) {
      ApiResponse.error(res, "Organization not found", 404);
      return;
    }

    ApiResponse.success(res, organization);
  });
}
