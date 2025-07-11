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

const register = async (req, res, next) => {
  console.log("[REGISTER SERVER]:", req.body);
  const {
    username,
    email,
    password,
    deviceName,
    imei,
    phoneNumber,
    plan,
    files,
  } = req.body;

  try {
    // Input validation
    if (
      !username ||
      !email ||
      !password ||
      !deviceName ||
      !imei ||
      !phoneNumber ||
      !plan ||
      !files ||
      files.length === 0
    ) {
      throw new CustomError(400, "Please provide all required fields");
    }

    // Validation regex patterns
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const imeiRegex = /^\d{15}$/;
    const phoneNumberRegex = /^\+?[\d\s\-()]{10,}$/;

    if (!emailRegex.test(email)) {
      throw new CustomError(400, "Please provide a valid email address");
    }

    // if (!imeiRegex.test(imei)) {
    //   throw new CustomError(400, "Please provide a valid IMEI");
    // }

    if (!phoneNumberRegex.test(phoneNumber)) {
      throw new CustomError(400, "Please provide a valid phone number");
    }

    // Password strength check
    if (password.length < 8) {
      throw new CustomError(400, "Password must be at least 8 characters long");
    }

    const validSubscriptionTypes = [
      "mobile-v4-basic",
      "mobile-v4-premium",
      "mobile-v4-enterprise",
      "mobile-v5-basic",
      "mobile-v5-premium",
      "full-suite-basic",
      "full-suite-premium",
    ];

    if (!validSubscriptionTypes.includes(plan)) {
      throw new CustomError(400, "Invalid encryption plan");
    }

    // Check if user already exists
    const existingUserByEmail = await User.findOne({ email });
    const existingUserByUsername = await User.findOne({ username });

    if (existingUserByEmail || existingUserByUsername) {
      throw new CustomError(
        400,
        "User with this email or username already exists"
      );
    }

    // Check if device already exists
    const existingDevice = await Device.findOne({ imei });
    if (existingDevice) {
      throw new CustomError(400, "Device with this IMEI is already registered");
    }

    // Check if phone number already has active subscription
    const existingSubscription = await Subscription.findOne({
      phone: phoneNumber,
      status: { $in: ["ACTIVE", "PENDING"] },
    });
    if (existingSubscription) {
      throw new CustomError(
        400,
        "Phone number already has an active subscription"
      );
    }

    // Hash password
    const salt = await bcrypt.genSalt(12); // Increased salt rounds for better security
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user
    const newUser = new User({
      username,
      email,
      password: hashedPassword,
    });

    await newUser.save();

    // Generate TOTP secret
    const totpSecret = generateRandomString(32);

    // Create new device
    const newDevice = new Device({
      user: newUser._id,
      imei,
      totpSecret,
      deviceName,
    });

    await newDevice.save(); // Save the device

    // Calculate subscription details
    const subscriptionPrice = getSubscriptionPrice(plan);
    const startDate = new Date();
    const subscriptionDuration = getSubscriptionDuration(plan);
    const endDate = new Date(
      startDate.getTime() + subscriptionDuration * 24 * 60 * 60 * 1000
    );

    // Create subscription
    const newSubscription = new Subscription({
      user: newUser._id,
      imei,
      phone: phoneNumber,
      email,
      plan,
      price: subscriptionPrice,
      cards: files,
      startDate, // Set start date directly
      endDate, // Set end date directly
      status: "PENDING",
    });

    await newSubscription.save(); // Save the subscription

    // Prepare user response (without password)
    const userResponse = newUser.toObject();
    delete userResponse.password;

    // Create JWT payload
    const payload = {
      user: {
        id: newUser.id,
        // email: newUser.email,
        // username: newUser.username,
      },
    };

    // Sign token using Promise instead of callback
    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: "7d" } // Extended token validity
    );

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    const refreshToken = jwt.sign(payload, process.env.REFRESH_SECRET, {
      expiresIn: "30d",
    });

    // Send success response
    res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: {
        ...userResponse,
        accessToken,
        refreshToken,
        // token,
        // user: userResponse,
        // device: {
        //   id: newDevice._id,
        //   imei: newDevice.imei,
        //   deviceName: newDevice.deviceName,
        //   isOnboarded: newDevice.isOnboarded || false,
        // },
        // subscription: {
        //   id: newSubscription._id,
        //   plan: newSubscription.plan,
        //   price: newSubscription.price,
        //   status: newSubscription.status,
        //   startDate: newSubscription.startDate,
        //   endDate: newSubscription.endDate,
        //   filesCount: files.length,
        // },
      },
    });
  } catch (err) {
    console.error("Registration error:", err);

    if (err instanceof CustomError) {
      next(err);
    } else if (err.code === 11000) {
      // MongoDB duplicate key error
      const field = Object.keys(err.keyPattern)[0];
      next(new CustomError(400, `${field} already exists`));
    } else if (err.name === "ValidationError") {
      // Mongoose validation error
      const messages = Object.values(err.errors).map((e) => e.message);
      next(new CustomError(400, messages.join(", ")));
    } else {
      next(new CustomError(500, "Server Error"));
    }
  }
};

const login = async (req, res, next) => {
  // console.log("[LOGIN SERVER]:", req.body);

  const { username, password } = req.body;

  try {
    // Find user by username or email
    let user = await User.findOne({
      $or: [{ email: username }, { username: username }],
    });

    if (!user) {
      throw new CustomError(401, "Invalid credentials");
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new CustomError(401, "Invalid credentials");
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
      success: true,
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

const getUser = async (req, res, next) => {
  // console.log("[getUser SERVER]:", req.user);

  try {
    const user = await User.findById(req.user._id).select("-password");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const devices = await Device.find({ user: req.user._id });

    // Get user's subscriptions
    const subscriptions = await Subscription.find({ user: req.user._id });

    res.json({
      success: true,
      message: "User fetched successfully",
      data: {
        user,
        devices,
        subscriptions,
      },
    });
  } catch (err) {
    next(err);
  }
};

const passUser = async (req, res, next) => {
  try {
    // console.log("uuu", req.user);
    // const user = await User.findById(req.user.id).select("-password");
    const user = req.user;

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    const payload = {
      user: {
        id: req.user._id.toString(),
      },
    };

    // Sign token
    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
      (err, token) => {
        if (err) throw err;

        // Filter out password from user object
        // const userResponse = user.toObject();
        // delete userResponse.password;

        // Send response with token and user info
        res.json({
          message: "Authentication successful",
          token,
          user,
        });
      }
    );
    // res.json(user);
  } catch (err) {
    next(err);
  }
};

const logout = async (req, res, next) => {
  try {
    // console.log("uuu", req.user);
    // const user = await User.findById(req.user.id).select("-password");

    // Sign token

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

module.exports = { login, register, getUser, passUser, logout };
