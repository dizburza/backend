import { Request, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { ApiResponse } from "../utils/response.util.js";
import { asyncHandler } from "../middlewares/errorHandler.middleware.js";
import { MembershipService } from "../services/membership.service.js";

const firstParam = (value: unknown): string => {
  if (Array.isArray(value)) return (value[0] as string) ?? "";
  return typeof value === "string" ? value : "";
};

/**
 * All a lookup returns: enough to confirm you have the right person before
 * paying them or adding them, and nothing more.
 *
 * Where someone works and which organizations they sign for used to come back
 * here. That told anyone who knew a username who their employer was, so it is
 * reduced to the one boolean the add-employee flow actually needs.
 */
const lookupColumns = {
  username: users.username,
  surname: users.surname,
  firstname: users.firstname,
  fullName: users.fullName,
  walletAddress: users.walletAddress,
  avatar: users.avatar,
};

const canBeEmployed = async (walletAddress: string): Promise<boolean> =>
  (await MembershipService.employmentFor(walletAddress)) === null;

export class UserController {
  static readonly resolveUsername = asyncHandler(async (req: Request, res: Response) => {
    const raw = firstParam(req.params.username).trim();
    const cleaned = raw.startsWith("@") ? raw.slice(1) : raw;
    const normalizedUsername = cleaned.toLowerCase();

    if (!normalizedUsername || normalizedUsername.length < 3) {
      ApiResponse.error(res, "Username must be at least 3 characters", 400);
      return;
    }

    const [user] = await db
      .select({ username: users.username, walletAddress: users.walletAddress })
      .from(users)
      .where(and(eq(users.username, normalizedUsername), eq(users.isActive, true)))
      .limit(1);

    if (!user) {
      ApiResponse.error(res, "User not found", 404);
      return;
    }

    ApiResponse.success(res, user);
  });

  static readonly searchByUsername = asyncHandler(
    async (req: Request, res: Response) => {
      const usernameParam = firstParam(req.params.username);

      if (!usernameParam || usernameParam.length < 3) {
        ApiResponse.error(res, "Username must be at least 3 characters", 400);
        return;
      }

      const [user] = await db
        .select(lookupColumns)
        .from(users)
        .where(
          and(eq(users.username, usernameParam.toLowerCase()), eq(users.isActive, true))
        )
        .limit(1);

      if (!user) {
        ApiResponse.error(res, "User not found", 404);
        return;
      }

      ApiResponse.success(res, {
        user,
        canBeAdded: true,
        canBeEmployed: await canBeEmployed(user.walletAddress),
      });
    }
  );

  static readonly searchByAddress = asyncHandler(
    async (req: Request, res: Response) => {
      const normalizedAddress = firstParam(req.params.address).trim().toLowerCase();

      const [user] = await db
        .select(lookupColumns)
        .from(users)
        .where(and(eq(users.walletAddress, normalizedAddress), eq(users.isActive, true)))
        .limit(1);

      if (!user) {
        ApiResponse.error(res, "User not found", 404);
        return;
      }

      ApiResponse.success(res, {
        user,
        canBeAdded: true,
        canBeEmployed: await canBeEmployed(user.walletAddress),
      });
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

    const rows = await db
      .select(lookupColumns)
      .from(users)
      .where(
        and(
          inArray(
            users.username,
            usernames.map((u: string) => String(u).toLowerCase())
          ),
          eq(users.isActive, true)
        )
      );

    const results = await Promise.all(
      rows.map(async (user) => ({
        ...user,
        canBeAdded: true,
        canBeEmployed: await canBeEmployed(user.walletAddress),
      }))
    );

    ApiResponse.success(res, { users: results });
  });
}
