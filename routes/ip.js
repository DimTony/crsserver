const express = require("express");
const router = express.Router();
const { auth } = require("../middleware/auth");
const { checkEncryptionByIMEI } = require("../controllers/ipController");
const { cloudinaryUploadMiddleware } = require("../config/fileHandler");

// All routes require authentication
router.use(auth);

// Device management
router.post("/check-encryption", checkEncryptionByIMEI);

module.exports = router;
