// routes/auth.js
const express = require("express");
const router = express.Router();
const {
  register,
  login,
  verifyEmail,
  resendVerificationEmail,
  getUser,
  passUser,
  logout,
} = require("../controllers/authController");
const { auth } = require("../middleware/auth");
const { cloudinaryUploadMiddleware } = require("../config/fileHandler");

// Registration route
router.post("/create", cloudinaryUploadMiddleware, register);

// Login route
router.post("/login", login);

// Email verification routes
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", resendVerificationEmail);

// Protected routes
router.get("/user", auth, getUser);
router.get("/", auth, passUser);
router.post("/logout", logout);

module.exports = router;
