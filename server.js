const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const dotenv = require("dotenv");
const logger = require("morgan");
const connectDB = require("./config/database");
const errorHandler = require("./middleware/errorHandler");
const CustomError = require("./utils/customError");

// Import routes
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");
const subscriptionRoutes = require("./routes/subscription");
const deviceRoutes = require("./routes/device");
const adminRoutes = require("./routes/admin");
const transactionRoutes = require("./routes/transaction");
const ipRoutes = require("./routes/ip");

// Import daily job
const {
  setupDailyJob,
  dailySubscriptionManager,
} = require("./jobs/dailySubscriptionCheck");

dotenv.config();

const app = express();

// Middleware
app.use(express.json());

// Production CORS configuration
const allowedOrigins = [
  process.env.FRONTEND_URL, // Your production frontend URL
  "http://localhost:3000", // Remove this in production
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`Blocked CORS request from origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(helmet());

// Logging (use 'combined' for production)
app.use(logger(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    jobStatus: dailySubscriptionManager.getStatus(),
  });
});

// Keep alive endpoint (for monitoring services)
app.get("/keep-alive", (req, res) => {
  res.status(200).send("Server is alive");
});

// Manual job trigger endpoint (admin only, for testing)
app.post("/api/admin/trigger-daily-job", async (req, res) => {
  try {
    const result = await dailySubscriptionManager.runManual();
    res.json({
      success: true,
      message: "Daily job executed successfully",
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Daily job execution failed",
      error: error.message,
    });
  }
});

// Connect to MongoDB and start daily job
connectDB()
  .then(() => {
    console.log("✅ Database connected successfully");

    // Initialize daily subscription job
    setupDailyJob();
    console.log("✅ Daily subscription job initialized");
  })
  .catch((error) => {
    console.error("❌ Database connection failed:", error);
    process.exit(1);
  });

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/ip", ipRoutes);

// 404 handler for undefined routes
app.all("*", (req, res, next) => {
  const err = new CustomError(404, "Resource not found");
  next(err);
});

// Global error handling middleware (should be last)
app.use(errorHandler);

const PORT = process.env.PORT || 8080;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
});

// Graceful shutdown handling
process.on("SIGTERM", () => {
  console.log("🔄 SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("✅ Process terminated");
  });
});

process.on("SIGINT", () => {
  console.log("🔄 SIGINT received, shutting down gracefully");
  server.close(() => {
    console.log("✅ Process terminated");
  });
});

process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err.name, ":", err.message);
  console.log("🔄 Shutting down due to unhandled rejection...");
  server.close(() => {
    process.exit(1);
  });
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err.name, ":", err.message);
  console.log("🔄 Shutting down due to uncaught exception...");
  process.exit(1);
});

module.exports = app;
