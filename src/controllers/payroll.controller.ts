import { Request, Response } from "express";
import { PayrollService } from "../services/payroll.service";
import { ApiResponse } from "../utils/response.util";
import { asyncHandler } from "../middlewares/errorHandler.middleware";

export class PayrollController {
  /**
   * POST /api/payroll/batches
   * Record batch creation after frontend calls smart contract
   */
  static recordBatchCreation = asyncHandler(
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
  static recordBatchApproval = asyncHandler(
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
  static recordBatchExecution = asyncHandler(
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
  static getBatches = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.query;

    const batches = await PayrollService.getBatchesForOrganization(
      id,
      status as string | undefined
    );

    ApiResponse.success(res, batches);
  });

  /**
   * POST /api/payroll/batches/:batchName/cancel
   * Record cancellation after frontend calls smart contract
   */
  static recordBatchCancellation = asyncHandler(
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
