import { Request, Response } from "express";
import { PayrollService } from "../services/payroll.service.js";
import { ApiResponse } from "../utils/response.util.js";
import { asyncHandler } from "../middlewares/errorHandler.middleware.js";

export class PayrollController {
  /**
   * POST /api/payroll/batches
   * Record batch creation after frontend calls smart contract
   */
  static readonly recordBatchCreation = asyncHandler(
    async (req: Request, res: Response) => {
      const {
        batchName,
        organizationId,
        organizationAddress,
        creatorAddress,
        recipients,
      } = req.body;

      const batch = await PayrollService.recordBatchCreation({
        batchName,
        organizationId,
        organizationAddress,
        creatorAddress,
        recipients,
      });

      ApiResponse.created(res, batch, "Batch payroll recorded successfully");
    }
  );

  /**
   * POST /api/payroll/batches/:batchName/approve
   * Record approval after frontend calls smart contract
   */
  static readonly recordBatchApproval = asyncHandler(
    async (req: Request, res: Response) => {
      const { batchName } = req.params;
      const { signerAddress, signerName } = req.body;

      const batch = await PayrollService.recordBatchApproval(
        batchName,
        signerAddress,
        signerName
      );

      ApiResponse.success(res, batch, "Batch approval recorded successfully");
    }
  );

  /**
   * POST /api/payroll/batches/:batchName/execute
   * Record execution after frontend calls smart contract
   */
  static readonly recordBatchExecution = asyncHandler(
    async (req: Request, res: Response) => {
      const { batchName } = req.params;
      const { executorAddress, txHash } = req.body;

      const batch = await PayrollService.recordBatchExecution(
        batchName,
        executorAddress,
        txHash
      );

      ApiResponse.success(res, batch, "Batch execution recorded successfully");
    }
  );

  /**
   * GET /api/payroll/organizations/:id/batches
   * Get batches from database
   */
  static readonly getBatches = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.query;

    const batches = await PayrollService.getBatchesForOrganization(
      id,
      status as string | undefined
    );

    ApiResponse.success(res, batches);
  });

  /**
   * GET /api/payroll/batches/:batchName
   * Get single batch details
   */
  static readonly getBatchByName = asyncHandler(async (req: Request, res: Response) => {
    const { batchName } = req.params;

    const batch = await PayrollService.getBatchByName(batchName);

    if (!batch) {
      ApiResponse.error(res, "Batch not found", 404);
      return;
    }

    ApiResponse.success(res, batch);
  });

  /**
   * POST /api/payroll/batches/:batchName/cancel
   * Record cancellation after frontend calls smart contract
   */
  static readonly recordBatchCancellation = asyncHandler(
    async (req: Request, res: Response) => {
      const { batchName } = req.params;

      const batch = await PayrollService.recordBatchCancellation(batchName);

      ApiResponse.success(
        res,
        batch,
        "Batch cancellation recorded successfully"
      );
    }
  );
}
