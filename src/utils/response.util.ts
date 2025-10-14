import { Response } from "express";

export class ApiResponse {
  static success(
    res: Response,
    data: any,
    message?: string,
    statusCode: number = 200
  ) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  }

  static error(
    res: Response,
    error: string,
    statusCode: number = 400,
    details?: any
  ) {
    return res.status(statusCode).json({
      success: false,
      error,
      details,
    });
  }

  static created(res: Response, data: any, message?: string) {
    return this.success(res, data, message, 201);
  }

  static noContent(res: Response) {
    return res.status(204).send();
  }
}