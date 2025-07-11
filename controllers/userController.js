const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const Device = require("../models/device");
const Subscription = require("../models/subscription");
const CustomError = require("../utils/customError");
const {
  getSubscriptionPrice,
  getSubscriptionDuration,
} = require("../utils/helpers");

// Helper function to generate random string for TOTP secret
const generateRandomString = (length) => {
  const crypto = require("crypto");
  return crypto.randomBytes(length).toString("hex");
};

const getProfile = async (req, res, next) => {
  // console.log('[GET PROFILE SERVER]:', req.user)
  //   const { username, password } = req.body;
  const userId = req.user._id.toString();

  try {
    // Find user by username or email
    // let user = await User.findOne({
    //   $or: [{ email: username }, { username: username }],
    // });

    let user = await User.findById(userId);

    if (!user) {
      throw new CustomError(400, "Invalid credentials");
    }

    // Create payload for JWT
    const payload = {
      user: {
        id: user.id,
      },
    };

    // Sign token
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    const refreshToken = jwt.sign(payload, process.env.REFRESH_SECRET, {
      expiresIn: "30d",
    });

    const userResponse = user.toObject();
    delete userResponse.password;

    // Send response with token and user info
    res.json({
      message: "Login successful",
      data: {
        ...userResponse,
        accessToken,
        refreshToken,
      },
      // token,
      // user: userResponse,
    });

    // (err, token) => {
    //   if (err) throw err;

    //   // Filter out password from user object
    // const userResponse = user.toObject();
    // delete userResponse.password;

    // // Send response with token and user info
    // res.json({
    //   message: "Login successful",
    //   token,
    //   user: userResponse,
    // });
    // }
    // );
  } catch (err) {
    next(err);
  }
};

module.exports = { getProfile };
