const express = require("express");
const router = express.Router();
const { auth, requireAdmin } = require("../middleware/auth");
// const { requireAdmin } = require("../middleware/admin"); // You'll need to create this
const {
  getQueuedSubscriptions,
  getQueuedSubscriptionDetails,
  approveSubscription,
  rejectSubscription,
  markUnderReview,
  updateQueuePosition,
  bulkUpdateSubscriptions,
  getAdminDashboard,
} = require("../controllers/adminController");

// Admin authentication middleware
router.use(auth);
router.use(requireAdmin);

// Dashboard and statistics
router.get("/dashboard", getAdminDashboard);

// Queue management
router.get("/queue", getQueuedSubscriptions);
router.get("/queue/:id", getQueuedSubscriptionDetails);

// Individual subscription actions
router.put("/queue/:id/approve", approveSubscription);
router.put("/queue/:id/reject", rejectSubscription);
router.put("/queue/:id/review", markUnderReview);
router.put("/queue/:id/position", updateQueuePosition);

// Bulk operations
router.post("/queue/bulk", bulkUpdateSubscriptions);


module.exports = router;
