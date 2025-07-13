const jwt = require("jsonwebtoken");
const CustomError = require("../utils/customError");
const User = require("../models/user");

// module.exports = function (req, res, next) {
//   // Get token from header
//   const token = req.header("x-auth-token");

//   console.log("ttt", token);

//   // Check if not token
//   if (!token) {
//     throw new CustomError(401, "No token, authorization denied");
//   }

//   try {
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     req.user = decoded.user;
//     next();
//   } catch (err) {
//     throw new CustomError(401, "Token is not valid");
//   }
// };

const auth = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.header("Authorization");

    // console.log("[Auth SERVER]:", authHeader);

    if (!authHeader) {
      throw new CustomError(401, "Unauthorized user");
    }

    // Check token format
    if (!authHeader.startsWith("Bearer ")) {
      throw new CustomError(401, "Invalid token format");
    }

    // Extract token
    const token = authHeader.replace("Bearer ", "");

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from database
      const user = await User.findById(decoded.user.id)
        .select("-password")
        .lean();

      // console.log("[Auth SERVER]:", user);

      if (!user) {
        throw new CustomError(401, "User not found");
      }

      // Add user and token to request
      req.user = user;
      req.token = token;

      next();
    } catch (error) {
      if (error.name === "JsonWebTokenError") {
        // console.error("Authentication failed: JWT error");
        throw new CustomError(401, "Invalid token");
      }
      if (error.name === "TokenExpiredError") {
        // console.error("Authentication failed: Token expired");

        throw new CustomError(401, "Token has expired");
      }
      throw error;
    }
  } catch (error) {
    console.error("Authentication error:", error);

    next(error);
  }
};

/**
 * Middleware to check if authenticated user has admin privileges
 * This middleware should be used after the auth middleware
 */
const requireAdmin = async (req, res, next) => {
  try {
    // Check if user is authenticated first
    if (!req.user) {
      throw new CustomError(401, "Authentication required");
    }

    // Check if user account is active and not suspended
    if (!req.user.isActive) {
      throw new CustomError(403, "Account is not active");
    }

    if (req.user.isSuspended) {
      throw new CustomError(403, "Account is suspended");
    }

    // Method 1: Check user role field (recommended)
    if (req.user.role !== "admin" && req.user.role !== "super_admin") {
      throw new CustomError(403, "Admin access required");
    }

    // Optional: Check specific admin permissions
    if (req.user.role === "admin" && req.user.adminInfo) {
      // Ensure admin has necessary permissions based on the route
      const routePath = req.route?.path || req.path;

      // Example permission checks based on route
      if (
        routePath.includes("/approve") &&
        !req.user.adminInfo.canApproveSubscriptions
      ) {
        throw new CustomError(
          403,
          "Insufficient permissions to approve subscriptions"
        );
      }

      if (
        routePath.includes("/analytics") &&
        !req.user.adminInfo.canViewAnalytics
      ) {
        throw new CustomError(
          403,
          "Insufficient permissions to view analytics"
        );
      }

      if (routePath.includes("/users") && !req.user.adminInfo.canManageUsers) {
        throw new CustomError(403, "Insufficient permissions to manage users");
      }
    }

    // Add admin info to request for use in controllers
    req.admin = {
      userId: req.user._id,
      role: req.user.role,
      permissions: req.user.permissions || [],
      accessLevel: req.user.adminInfo?.accessLevel || 1,
      canApprove: req.user.adminInfo?.canApproveSubscriptions || false,
      maxApprovalAmount: req.user.adminInfo?.maxApprovalAmount || 0,
    };

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware to check for super admin privileges
 * Use this for highly sensitive operations
 */
const requireSuperAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      throw new CustomError(401, "Authentication required");
    }

    if (!req.user.isActive || req.user.isSuspended) {
      throw new CustomError(403, "Account access denied");
    }

    if (req.user.role !== "super_admin") {
      throw new CustomError(403, "Super admin access required");
    }

    req.admin = {
      userId: req.user._id,
      role: req.user.role,
      permissions: ["*"], // Super admin has all permissions
      accessLevel: 10,
      canApprove: true,
      maxApprovalAmount: Infinity,
    };

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware to check specific permission
 * Usage: requirePermission('approve_subscriptions')
 */
const requirePermission = (permission) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        throw new CustomError(401, "Authentication required");
      }

      // Super admin has all permissions
      if (req.user.role === "super_admin") {
        return next();
      }

      // Check if user has the specific permission
      if (!req.user.hasPermission || !req.user.hasPermission(permission)) {
        throw new CustomError(403, `Permission required: ${permission}`);
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

/**
 * Middleware to check approval amount limits
 * Use this for subscription approvals with monetary values
 */
const requireApprovalLimit = async (req, res, next) => {
  try {
    if (!req.user || !req.admin) {
      throw new CustomError(401, "Admin authentication required");
    }

    // Get the amount from request body (for approvals)
    const amount = req.body.amount || req.body.price || 0;
    const maxAmount = req.admin.maxApprovalAmount || 0;

    // Super admin has no limits
    if (req.user.role === "super_admin") {
      return next();
    }

    // Check if admin can approve this amount
    if (amount > maxAmount) {
      throw new CustomError(
        403,
        `Approval amount (${amount}) exceeds your limit (${maxAmount}). Please escalate to a higher authority.`
      );
    }

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Alternative implementation using environment variables for admin emails
 * Use this if you don't want to implement role-based system initially
 */
const requireAdminByEmail = async (req, res, next) => {
  try {
    if (!req.user) {
      throw new CustomError(401, "Authentication required");
    }

    // Get admin emails from environment variable
    const adminEmails =
      process.env.ADMIN_EMAILS?.split(",").map((email) => email.trim()) || [];

    if (adminEmails.length === 0) {
      console.warn(
        "⚠️ No admin emails configured in ADMIN_EMAILS environment variable"
      );
      throw new CustomError(500, "Admin system not configured");
    }

    if (!adminEmails.includes(req.user.email)) {
      throw new CustomError(403, "Admin access required");
    }

    // Basic admin info
    req.admin = {
      userId: req.user._id,
      role: "admin",
      email: req.user.email,
      permissions: ["*"], // Full permissions for email-based admins
    };

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware to log admin actions for audit trail
 */
const logAdminAction = async (req, res, next) => {
  // Store original res.json to intercept response
  const originalJson = res.json;

  res.json = function (data) {
    // Log the admin action
    console.log({
      timestamp: new Date().toISOString(),
      adminId: req.admin?.userId,
      adminRole: req.admin?.role,
      action: `${req.method} ${req.path}`,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      body: req.method !== "GET" ? req.body : undefined,
      success: data?.success !== false,
    });

    // TODO: Save to audit log database
    // const AuditLog = require('../models/auditLog');
    // AuditLog.create({
    //   adminId: req.admin?.userId,
    //   action: `${req.method} ${req.path}`,
    //   details: { body: req.body, response: data },
    //   ip: req.ip,
    //   userAgent: req.get('User-Agent'),
    // });

    // Call original json method
    return originalJson.call(this, data);
  };

  next();
};

module.exports = {
  requireAdmin,
  requireSuperAdmin,
  requirePermission,
  requireApprovalLimit,
  requireAdminByEmail,
  logAdminAction,
  auth,
};
