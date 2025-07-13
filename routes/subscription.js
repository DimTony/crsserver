const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/auth");
const {
  //   upgradeSubscription,
  //   downgradeSubscription,
  //   cancelSubscription,
  //   renewSubscription,
  //   getSubscriptionStatus,
  //   getDeviceQueueStatus,
  checkDeviceIsOnboarded,
  setupDeviceOtp,
  activateSubscription,
} = require("../controllers/subscriptionController");

// All routes require authentication
router.use(auth);

// Device management
router.post("/check-device", checkDeviceIsOnboarded);
router.post("/setup", setupDeviceOtp);
router.post("/activate", activateSubscription);

// // Subscription management
// router.post("/:id/upgrade", upgradeSubscription);
// router.post("/:id/downgrade", downgradeSubscription);
// router.post("/:id/cancel", cancelSubscription);
// router.post("/:id/renew", renewSubscription);

// // Status checking
// router.get("/status", getSubscriptionStatus);
// router.get("/device/:imei/queue", getDeviceQueueStatus);

module.exports = router;
