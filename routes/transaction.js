// routes/transactions.js
const express = require("express");
const router = express.Router();
const { auth, requireAdmin } = require("../middleware/auth");
const {
  getAllTransactions,
  getUserTransactions,
  getTransactionDetails,
  getFinancialSummary,
  updateTransactionStatus,
  createManualTransaction,
  getTransactionAnalytics,
  exportTransactions,
} = require("../controllers/transactionController");

// All routes require authentication
router.use(auth);

// User routes - users can access their own transaction data
router.get("/my-transactions", getUserTransactions);
router.get("/:id", getTransactionDetails);

// Admin-only routes
router.use(requireAdmin);

// Get all transactions with filtering (admin only)
router.get("/", getAllTransactions);

// Get specific user's transactions (admin only)
router.get("/user/:userId", getUserTransactions);

// Financial reporting and analytics
router.get("/reports/financial-summary", getFinancialSummary);
router.get("/reports/analytics", getTransactionAnalytics);
router.get("/reports/export", exportTransactions);

// Transaction management
router.put("/:id/status", updateTransactionStatus);
router.post("/manual", createManualTransaction);

module.exports = router;
