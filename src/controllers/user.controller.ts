import { Request, Response } from "express";
import { User } from "../models/User.model";
import { ApiResponse } from "../utils/response.util";
import { asyncHandler } from "../middlewares/errorHandler.middleware";

export class UserController {
  /**
   * GET /api/users/search/:username
   * Search user by username for adding as signer
   */
  static searchByUsername = asyncHandler(
    async (req: Request, res: Response) => {
      const { username } = req.params;

      if (!username || username.length < 3) {
        return ApiResponse.error(
          res,
          "Username must be at least 3 characters",
          400
        );
      }

      const user = await User.findOne({
        username: username.toLowerCase(),
        isActive: true,
      }).select(
        "username surname firstname fullName walletAddress avatar email role organizationId organizationSlug"
      );

      if (!user) {
        return ApiResponse.error(res, "User not found", 404);
      }

      // Check if user is already a signer of another organization
      const isAlreadySigner = user.organizationId && user.role === "signer";

      return ApiResponse.success(res, {
        user: {
          username: user.username,
          surname: user.surname,
          firstname: user.firstname,
          fullName: user.fullName,
          walletAddress: user.walletAddress,
          avatar: user.avatar,
          email: user.email,
          isAlreadySigner,
          currentOrganization: user.organizationSlug,
        },
        canBeAdded: !isAlreadySigner, // Can only be signer in one org
      });
    }
  );

  /**
   * GET /api/users/suggest?query=john
   * Auto-suggest usernames as user types
   */
  static suggestUsernames = asyncHandler(
    async (req: Request, res: Response) => {
      const { query } = req.query;

      if (!query || (query as string).length < 2) {
        return ApiResponse.success(res, { suggestions: [] });
      }

      // Find users whose username starts with query
      const users = await User.find({
        username: { $regex: `^${query}`, $options: "i" },
        isActive: true,
      })
        .select("username fullName avatar")
        .limit(10);

      const suggestions = users.map((u) => ({
        username: u.username,
        fullName: u.fullName,
        avatar: u.avatar,
      }));

      return ApiResponse.success(res, { suggestions });
    }
  );

  /**
   * POST /api/users/batch-lookup
   * Look up multiple usernames at once
   */
  static batchLookup = asyncHandler(async (req: Request, res: Response) => {
    const { usernames } = req.body;

    if (!Array.isArray(usernames) || usernames.length === 0) {
      return ApiResponse.error(res, "Usernames array is required", 400);
    }

    if (usernames.length > 20) {
      return ApiResponse.error(res, "Maximum 20 usernames allowed", 400);
    }

    const users = await User.find({
      username: { $in: usernames.map((u: string) => u.toLowerCase()) },
      isActive: true,
    }).select(
      "username surname firstname fullName walletAddress avatar email role organizationId"
    );

    const results = users.map((user) => ({
      username: user.username,
      surname: user.surname,
      firstname: user.firstname,
      fullName: user.fullName,
      walletAddress: user.walletAddress,
      avatar: user.avatar,
      isAlreadySigner: user.organizationId && user.role === "signer",
      canBeAdded: !(user.organizationId && user.role === "signer"),
    }));

    return ApiResponse.success(res, { users: results });
  });
}