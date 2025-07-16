const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/auth");
const { searchDevices } = require("../controllers/deviceController");

// All routes require authentication
router.use(auth);

router.get("/search", searchDevices);
// router.get("/device/:imei/queue", getDeviceQueueStatus);

module.exports = router;
