const express = require("express");
const router = express.Router();
const { auth, requireAdmin } = require("../middleware/auth");
const { cloudinaryUploadMiddleware } = require("../config/fileHandler");
const {
  getPendingSubscriptions,
  getSubscriptionDetails,
  approveSubscription,
  rejectSubscription,
  activateSubscription,
  updateQueuePosition,
  bulkUpdateSubscriptions,
  getAdminDashboard,
  logTransactionUpdate,

  queueSubscriptionForUser,
  moveSubscriptionToQueue,
  getDeviceQueueStatus,
  bulkQueueOperations,
  getQueueDashboard,
} = require("../controllers/adminController");

// Admin authentication middleware
router.use(auth);
router.use(requireAdmin);

// Dashboard and statistics
router.get("/dashboard", getAdminDashboard);


// Individual subscription actions
router.put("/queue/:id/approve", approveSubscription);
router.put("/queue/:id/reject", rejectSubscription);
router.put("/queue/:id/position", updateQueuePosition);

// Bulk operations
router.post("/queue/bulk", bulkUpdateSubscriptions);

// Queue dashboard and overview
router.get("/queue/dashboard", getQueueDashboard);
// Device queue management
router.get("/device/:imei", getDeviceQueueStatus);
// Create new queued subscription for user
router.post("/create", cloudinaryUploadMiddleware, queueSubscriptionForUser);
// Move existing subscription to queue
router.put("/move/:subscriptionId", moveSubscriptionToQueue);
// Update queue position
router.put("/position/:subscriptionId", updateQueuePosition);
// Bulk operations
router.post("/bulk", bulkQueueOperations);


module.exports = router;
