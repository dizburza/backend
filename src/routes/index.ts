import { Router } from "express";
import authRoutes from "./auth.routes";
import walletRoutes from "./wallet.routes";
import transactionRoutes from "./transaction.routes";
import organizationRoutes from "./organization.routes";
import payrollRoutes from "./payroll.routes";
import userRoutes from "./user.routes";

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
router.use("/auth", authRoutes);
router.use("/wallet", walletRoutes);
router.use("/transactions", transactionRoutes);
router.use("/organizations", organizationRoutes);
router.use("/payroll", payrollRoutes);

router.use("/users", userRoutes);

export default router;