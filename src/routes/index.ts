import { Router } from "express";
import authRoutes from "./auth.routes.js";
import walletRoutes from "./wallet.routes.js";
import transactionRoutes from "./transaction.routes.js";
import organizationRoutes from "./organization.routes.js";
import payrollRoutes from "./payroll.routes.js";
import proposalRoutes from "./proposal.routes.js";
import taxRoutes from "./tax.routes.js";
import cashLinkRoutes from "./cashlink.routes.js";
import userRoutes from "./user.routes.js";
import webhookRoutes from "./webhooks.routes.js";
import balanceRoutes from "./realtime.routes.js";
import eventRoutes from "./events.routes.js";
import { TokenService } from "../services/token.service.js";

const router = Router();

/**
 * The token this deployment pays in. Public and unauthenticated: it is the same
 * for everyone and the browser needs its decimals to build a contract call.
 */
router.get("/token", async (_req, res, next) => {
  try {
    const token = await TokenService.getDefault();
    res.json({
      success: true,
      data: {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        logoUrl: token.logoUrl,
        chainId: token.chainId,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Health check
router.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

// Mount routes
router.use("/auth", authRoutes);
router.use("/wallet", walletRoutes);
router.use("/transactions", transactionRoutes);
router.use("/organizations", organizationRoutes);
router.use("/payroll", payrollRoutes);
router.use("/proposals", proposalRoutes);
router.use("/tax", taxRoutes);
router.use("/cashlinks", cashLinkRoutes);

router.use("/users", userRoutes);
router.use("/webhooks", webhookRoutes);
router.use("/balances", balanceRoutes);
router.use("/events", eventRoutes);

export default router;