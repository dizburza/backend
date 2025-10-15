import express from "express";
import { corsMiddleware } from "./middlewares/cors.middleware";
import {
  helmetMiddleware,
  hppMiddleware,
} from "./middlewares/security.middleware";
import { sanitizeMiddleware } from "./middlewares/sanitize.middleware";
import { requestLogger } from "./middlewares/logger.middleware";
import { generalLimiter } from "./middlewares/rateLimiter.middleware";
import {
  errorHandler,
  notFoundHandler,
} from "./middlewares/errorHandler.middleware";
import routes from "./routes";

const app = express();

// Security & parsing
app.use(corsMiddleware);
app.use(helmetMiddleware);
app.use(hppMiddleware);
app.use(sanitizeMiddleware);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Logging & rate limiting
app.use(requestLogger);
app.use(generalLimiter);

// API routes
app.use("/api", routes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
