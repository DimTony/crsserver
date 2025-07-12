const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/auth");
const {
  upgradeSubscription,
  downgradeSubscription,
  cancelSubscription,
  renewSubscription,
  getSubscriptionStatus,
  getDeviceQueueStatus,
} = require("../controllers/subscriptionController");

// All routes require authentication
router.use(auth);

// Subscription management
router.post("/:id/upgrade", upgradeSubscription);
router.post("/:id/downgrade", downgradeSubscription);
router.post("/:id/cancel", cancelSubscription);
router.post("/:id/renew", renewSubscription);

// Status checking
router.get("/status", getSubscriptionStatus);
router.get("/device/:imei/queue", getDeviceQueueStatus);

module.exports = router;
