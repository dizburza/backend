import { Request, Response } from "express";
import { AuthService } from "../services/auth.service";
import { ApiResponse } from "../utils/response.util";
import { asyncHandler } from "../middlewares/errorHandler.middleware";

export class AuthController {
  /**
   * POST /api/auth/register
   */
  static register = asyncHandler(async (req: Request, res: Response) => {
    const {
      walletAddress,
      username,
      surname,
      firstname,
      fullName,
      email,
      phoneNumber,
      avatar,
      role,
    } = req.body;

    const result = await AuthService.register({
      walletAddress,
      username,
      surname,
      firstname,
      fullName,
      email,
      phoneNumber,
      avatar,
      role,
    });

    ApiResponse.created(res, result, "User registered successfully");
  });

  /**
   * POST /api/auth/login
   */
  static login = asyncHandler(async (req: Request, res: Response) => {
    const { walletAddress, signature, message } = req.body;

    const result = await AuthService.login({
      walletAddress,
      signature,
      message,
    });

    ApiResponse.success(res, result, "Login successful");
  });

  /**
   * GET /api/auth/check/:address
   */
  static checkStatus = asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params;

    const result = await AuthService.checkUserStatus(address);

    ApiResponse.success(res, result);
  });

  /**
   * GET /api/auth/message/:address
   */
  static getAuthMessage = asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params;

    const message = await AuthService.getAuthMessage(address);

    ApiResponse.success(res, { message });
  });

  /**
   * GET /api/auth/me
   */
  static getProfile = asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.success(res, { user: req.user });
  });
}
