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
  renewActiveSubscription,
  getRenewalOptions,
  getRenewalHistory,
  newSubscription,
  addDeviceSubscription,
  addSubscriptionToMyDevice,
  checkActiveSubscriptionStatus,
} = require("../controllers/subscriptionController");
const { cloudinaryUploadMiddleware } = require("../config/fileHandler");


// All routes require authentication
router.use(auth);

// Device management
router.post("/check-device", checkDeviceIsOnboarded);
router.post("/setup", setupDeviceOtp);
router.post("/activate", activateSubscription);
router.post("/new-device", cloudinaryUploadMiddleware, addDeviceSubscription);
router.post("/new", cloudinaryUploadMiddleware, addSubscriptionToMyDevice);


// Subscription renewal endpoints
router.get("/:id/renewal-options", getRenewalOptions);
router.get("/active-status", checkActiveSubscriptionStatus);
router.post("/:id/renew", renewActiveSubscription);
router.get("/:id/renewal-history", getRenewalHistory);

// // Subscription management
// router.post("/:id/upgrade", upgradeSubscription);
// router.post("/:id/downgrade", downgradeSubscription);
// router.post("/:id/cancel", cancelSubscription);
// router.post("/:id/renew", renewSubscription);

// // Status checking
// router.get("/status", getSubscriptionStatus);
// router.get("/device/:imei/queue", getDeviceQueueStatus);

module.exports = router;
