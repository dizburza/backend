import { Request, Response } from "express";
import { User } from "../models/User.model.js";
import { ApiResponse } from "../utils/response.util.js";
import { asyncHandler } from "../middlewares/errorHandler.middleware.js";

export class UserController {
  static readonly searchByUsername = asyncHandler(
    async (req: Request, res: Response) => {
      const { username } = req.params;

      if (!username || username.length < 3) {
        ApiResponse.error(res, "Username must be at least 3 characters", 400);
        return;
      }

      const user = await User.findOne({
        username: username.toLowerCase(),
        isActive: true,
      }).select(
        "username surname firstname fullName walletAddress avatar email role organizationId organizationSlug"
      );

      if (!user) {
        ApiResponse.error(res, "User not found", 404);
        return;
      }

      const isAlreadySigner = user.organizationId && user.role === "signer";

      ApiResponse.success(res, {
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
        canBeAdded: !isAlreadySigner,
      });
    }
  );

  static readonly suggestUsernames = asyncHandler(
    async (req: Request, res: Response) => {
      const { query } = req.query;

      const queryString = typeof query === "string" ? query : "";
      const escapedQuery = queryString.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

      if (!escapedQuery || queryString.length < 2) {
        ApiResponse.success(res, { suggestions: [] });
        return;
      }

      const users = await User.find({
        username: { $regex: new RegExp(`^${escapedQuery}`, "i") },
        isActive: true,
      })
        .select("username fullName avatar")
        .limit(10);

      const suggestions = users.map((u) => ({
        username: u.username,
        fullName: u.fullName,
        avatar: u.avatar,
      }));

      ApiResponse.success(res, { suggestions });
    }
  );

  static readonly batchLookup = asyncHandler(async (req: Request, res: Response) => {
    const { usernames } = req.body;

    if (!Array.isArray(usernames) || usernames.length === 0) {
      ApiResponse.error(res, "Usernames array is required", 400);
      return;
    }

    if (usernames.length > 20) {
      ApiResponse.error(res, "Maximum 20 usernames allowed", 400);
      return;
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

    ApiResponse.success(res, { users: results });
  });
}