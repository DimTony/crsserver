// routes/device.js - Updated version

const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/auth");
const { cloudinaryUploadMiddleware } = require("../config/fileHandler");
const {
  searchDevices,
  addNewDeviceForUser,
  getUserDevices,
} = require("../controllers/deviceController");

// All routes require authentication
router.use(auth);

// Search devices (existing)
router.get("/search", searchDevices);

// Get user's devices with subscription info
router.get("/my-devices", getUserDevices);

// Add new device for existing user
router.post("/add", cloudinaryUploadMiddleware, addNewDeviceForUser);

module.exports = router;
