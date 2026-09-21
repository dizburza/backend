import { Router } from "express";
import { InviteController } from "../controllers/invite.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { lookupLimiter } from "../middlewares/rateLimiter.middleware.js";

const router = Router();

/**
 * Opening a link happens before the claimer has an account, so this one route
 * is public. It is rate limited like a directory lookup: the token is 32 random
 * bytes and not worth guessing, but an open endpoint that confirms
 * organizations exist should not be free to hammer.
 */
router.get("/:token", lookupLimiter, InviteController.describe);

// Claiming needs a session, because the account being attached is the session's
// and the email matched against the invitation is the session's too.
router.post("/:token/claim", authenticate, InviteController.claim);

export default router;
