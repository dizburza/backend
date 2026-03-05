import { Request, Response } from "express";
import { AuthService } from "../services/auth.service.js";
import { ApiResponse } from "../utils/response.util.js";
import { asyncHandler } from "../middlewares/errorHandler.middleware.js";

export class AuthController {
  /**
   * POST /api/auth/register
   */
  static readonly register = asyncHandler(async (req: Request, res: Response) => {
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
  static readonly login = asyncHandler(async (req: Request, res: Response) => {
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
  static readonly checkStatus = asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params as any;
    const addressParam = Array.isArray(address) ? address[0] : address;

    const result = await AuthService.checkUserStatus(addressParam);

    ApiResponse.success(res, result);
  });

  /**
   * GET /api/auth/message/:address
   */
  static readonly getAuthMessage = asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params as any;
    const addressParam = Array.isArray(address) ? address[0] : address;

    const message = await AuthService.getAuthMessage(addressParam);

    ApiResponse.success(res, { message });
  });

  /**
   * GET /api/auth/me
   */
  static readonly getProfile = asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.success(res, { user: req.user });
  });
}
