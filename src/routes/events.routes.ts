import { Router } from "express";
import { RealtimeController } from "../controllers/realtime.controller.js";
import { optionalAuth } from "../middlewares/auth.middleware.js";

const router = Router();

/**
 * SSE stream, authenticated by the session cookie.
 *
 * EventSource cannot set an Authorization header, which is why this was
 * unauthenticated while the token lived in localStorage. Cookies are sent
 * automatically, so the stream can now identify the caller and restrict which
 * addresses they may subscribe to.
 *
 * optionalAuth rather than authenticate: the controller returns 401 itself so
 * the response shape stays consistent for an EventSource client.
 */
router.get("/stream", optionalAuth, RealtimeController.stream);

export default router;
