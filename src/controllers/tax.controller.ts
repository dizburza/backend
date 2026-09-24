import { Request, Response } from "express";
import { TaxService } from "../services/tax.service.js";
import { TaxDocumentService } from "../services/taxDocument.service.js";
import { ApiResponse } from "../utils/response.util.js";
import { asyncHandler, AppError } from "../middlewares/errorHandler.middleware.js";

const firstParam = (value: unknown): string =>
  Array.isArray(value) ? String(value[0]) : String(value);

/** Downloads, so they open with a sensible name rather than a uuid. */
const sendPdf = (res: Response, pdf: Buffer, filename: string): void => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", pdf.length);
  res.end(pdf);
};

export class TaxController {
  /** GET /api/tax/me */
  static readonly myLines = asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.success(res, await TaxService.linesForUser(req.user!.id));
  });

  /** GET /api/tax/me/statement.pdf?year=2026 */
  static readonly myStatement = asyncHandler(async (req: Request, res: Response) => {
    const year = Number.parseInt(String(req.query.year ?? ""), 10);
    const resolved = Number.isInteger(year) ? year : new Date().getUTCFullYear();

    if (resolved < 2000 || resolved > 2200) {
      throw new AppError("Year is out of range", 400);
    }

    const pdf = await TaxDocumentService.statement(req.user!.id, resolved);
    sendPdf(res, pdf, `paye-statement-${resolved}.pdf`);
  });

  /**
   * GET /api/tax/lines/:lineId/receipt.pdf
   *
   * Authorization lives in the document service rather than a middleware,
   * because who may read a line is a property of the line: the person it
   * describes, or a signer of the organization that paid it.
   */
  static readonly receipt = asyncHandler(async (req: Request, res: Response) => {
    const lineId = firstParam(req.params.lineId);

    const pdf = await TaxDocumentService.receipt(lineId, {
      userId: req.user!.id,
      walletAddress: req.user!.walletAddress,
    });

    sendPdf(res, pdf, `paye-receipt-${lineId.slice(0, 8)}.pdf`);
  });

  /** GET /api/tax/organizations/:organizationId/batches/:batchId */
  static readonly linesForBatch = asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.success(res, await TaxService.linesForBatch(firstParam(req.params.batchId)));
  });

  /** POST /api/tax/organizations/:organizationId/preview */
  static readonly preview = asyncHandler(async (req: Request, res: Response) => {
    const addresses = req.body.addresses as string[];
    ApiResponse.success(
      res,
      await TaxService.previewForAddresses(firstParam(req.params.organizationId), addresses)
    );
  });
}
