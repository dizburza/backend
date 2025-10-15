import app from "./app";
import { ENV } from "./config/environment";
import connectDB from "./config/database";
import { BlockchainListener } from "./listeners/blockchain.listener";
import logger from "./utils/logger.util";

async function startServer() {
  try {
    // Connect to database
    await connectDB();
    logger.info("✅ Database connected");

    // Start blockchain listener
    const blockchainListener = new BlockchainListener();
    await blockchainListener.start();

    // Start server
    const server = app.listen(ENV.PORT, () => {
      logger.info(`🚀 Server running on port ${ENV.PORT}`);
      logger.info(`📡 Environment: ${ENV.NODE_ENV}`);
      logger.info(`🌍 API URL: http://localhost:${ENV.PORT}/api`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} signal received: closing HTTP server`);

      // Stop blockchain listener
      blockchainListener.stop();

      // Close server
      server.close(() => {
        logger.info("HTTP server closed");
      });

      // Close database connection
      try {
        await import("mongoose").then((mongoose) =>
          mongoose.default.connection.close()
        );
        logger.info("Database connection closed");
      } catch (error) {
        logger.error("Error closing database:", error);
      }

      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    // Handle uncaught exceptions
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception:", error);
      shutdown("UNCAUGHT_EXCEPTION");
    });

    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled Rejection at:", promise, "reason:", reason);
      shutdown("UNHANDLED_REJECTION");
    });
  } catch (error) {
    logger.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
