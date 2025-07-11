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
      throw new CustomError(401, "No authentication token provided");
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

module.exports = { auth };
