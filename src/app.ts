import express from "express";
import { corsMiddleware } from "./middlewares/cors.middleware.js";
import {
  helmetMiddleware,
  hppMiddleware,
} from "./middlewares/security.middleware.js";
import { sanitizeMiddleware } from "./middlewares/sanitize.middleware.js";
import { requestLogger } from "./middlewares/logger.middleware.js";
import { generalLimiter } from "./middlewares/rateLimiter.middleware.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middlewares/errorHandler.middleware.js";
import routes from "./routes/index.js";

const app = express();

// Security & parsing
app.use(corsMiddleware);
app.use(helmetMiddleware);
app.use(hppMiddleware);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeMiddleware);

// Logging & rate limiting
app.use(requestLogger);
app.use(generalLimiter);

// API routes
app.use("/api", routes);

app.get("/", (_req, res) => {
  res.send("🚀 Dizburza Backend API is running...");
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
