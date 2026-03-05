import { Router } from "express";
import authRoutes from "./auth.routes.js";
import walletRoutes from "./wallet.routes.js";
import transactionRoutes from "./transaction.routes.js";
import organizationRoutes from "./organization.routes.js";
import payrollRoutes from "./payroll.routes.js";
import userRoutes from "./user.routes.js";
import webhookRoutes from "./webhooks.routes.js";
import { dbMiddleware } from "../middlewares/db.middleware.js";

const router = Router();

// Health check
router.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

// Mount routes
router.use("/auth", dbMiddleware, authRoutes);
router.use("/wallet", dbMiddleware, walletRoutes);
router.use("/transactions", dbMiddleware, transactionRoutes);
router.use("/organizations", dbMiddleware, organizationRoutes);
router.use("/payroll", dbMiddleware, payrollRoutes);

router.use("/users", dbMiddleware, userRoutes);
router.use("/webhooks", dbMiddleware, webhookRoutes);

export default router;