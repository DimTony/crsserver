// middleware/emailVerification.js
const CustomError = require("../utils/customError");

// Middleware to check if user's email is verified
const requireEmailVerification = (req, res, next) => {
  try {
    // Check if user is authenticated first
    if (!req.user) {
      throw new CustomError(401, "Authentication required");
    }

    // Check if email is verified
    if (!req.user.isEmailVerified) {
      return res.status(403).json({
        success: false,
        message:
          "Email verification required. Please verify your email address to access this resource.",
        data: {
          requiresVerification: true,
          email: req.user.email,
        },
      });
    }

    // Check if account is active
    if (!req.user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account is not active. Please contact support.",
        data: {
          accountInactive: true,
        },
      });
    }

    next();
  } catch (err) {
    next(err);
  }
};

// Middleware to allow access only to unverified users (for verification endpoints)
const requireUnverifiedEmail = (req, res, next) => {
  try {
    if (!req.user) {
      throw new CustomError(401, "Authentication required");
    }

    if (req.user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
        data: {
          alreadyVerified: true,
        },
      });
    }

    next();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  requireEmailVerification,
  requireUnverifiedEmail,
};
