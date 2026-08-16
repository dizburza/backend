import { Request, Response } from "express";
import { AuthService } from "../services/auth.service.js";
import { ApiResponse } from "../utils/response.util.js";
import { asyncHandler } from "../middlewares/errorHandler.middleware.js";
import { clearSessionCookies, setSessionCookies } from "../utils/session.util.js";

/**
 * The token is delivered as an httpOnly cookie and deliberately not returned in
 * the body, so a compromised script on the page cannot read it. The response
 * still carries the user and redirect the client needs.
 */
const respondWithSession = (
  res: Response,
  result: { user: { walletAddress: string }; token: string },
  message: string,
  created = false
) => {
  setSessionCookies(res, result.token, result.user.walletAddress);

  const { token: _token, ...body } = result as Record<string, unknown> & {
    token: string;
  };

  if (created) ApiResponse.created(res, body, message);
  else ApiResponse.success(res, body, message);
};

export class AuthController {
  /**
   * POST /api/auth/register
   */
  static readonly register = asyncHandler(async (req: Request, res: Response) => {
    const {
      walletAddress,
      signature,
      username,
      surname,
      firstname,
      fullName,
      email,
      phoneNumber,
      avatar,
    } = req.body;

    const result = await AuthService.register({
      walletAddress,
      signature,
      username,
      surname,
      firstname,
      fullName,
      email,
      phoneNumber,
      avatar,
    });

    respondWithSession(res, result, "User registered successfully", true);
  });

  /**
   * POST /api/auth/login
   */
  static readonly login = asyncHandler(async (req: Request, res: Response) => {
    const { walletAddress, signature } = req.body;

    const result = await AuthService.login({ walletAddress, signature });

    respondWithSession(res, result, "Login successful");
  });

  /**
   * POST /api/auth/logout
   */
  static readonly logout = asyncHandler(async (_req: Request, res: Response) => {
    clearSessionCookies(res);
    ApiResponse.success(res, { loggedOut: true }, "Logged out");
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
    if (!req.user) {
      ApiResponse.error(res, "Authentication required", 401);
      return;
    }

    ApiResponse.success(res, await AuthService.sessionFor(req.user));
  });
}
