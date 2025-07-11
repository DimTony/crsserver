// controllers/authController.js - Enhanced with graceful error handling
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
const {
  generateVerificationToken,
  sendVerificationEmail,
  sendWelcomeEmail,
} = require("../config/emailService");

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
      !plan
    ) {
      throw new CustomError(400, "Please provide all required fields");
    }

    // Check if files were uploaded (handle upload failures gracefully)
    if (!files || files.length === 0) {
      // Check if there were upload errors
      if (req.body.uploadErrors && req.body.uploadErrors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "File upload failed. Please try uploading your files again.",
          error: "FILE_UPLOAD_REQUIRED",
          uploadErrors: req.body.uploadErrors,
        });
      }

      throw new CustomError(
        400,
        "Please upload at least one encryption card file"
      );
    }

    // Handle partial upload failures
    if (req.body.uploadWarnings && req.body.uploadWarnings.length > 0) {
      console.warn(`⚠️ Some files failed to upload:`, req.body.uploadWarnings);
      // Continue with registration but log the warnings
    }

    // Validation regex patterns
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneNumberRegex = /^\+?[\d\s\-()]{10,}$/;

    if (!emailRegex.test(email)) {
      throw new CustomError(400, "Please provide a valid email address");
    }

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

    if (existingUserByEmail) {
      // If user exists but email not verified, handle re-registration
      if (!existingUserByEmail.isEmailVerified) {
        try {
          const verificationToken =
            existingUserByEmail.generateVerificationToken();
          await existingUserByEmail.save();

          // Try to send verification email, but don't fail registration if email fails
          try {
            await sendVerificationEmail(email, verificationToken, username);
          } catch (emailError) {
            console.error("Failed to send verification email:", emailError);
            // Continue without failing
          }

          return res.status(200).json({
            success: true,
            message:
              "Account already exists but email not verified. New verification email sent.",
            data: {
              requiresVerification: true,
              email: existingUserByEmail.email,
            },
          });
        } catch (dbError) {
          console.error("Database error during re-registration:", dbError);
          throw new CustomError(
            500,
            "Failed to process registration. Please try again."
          );
        }
      }

      throw new CustomError(
        400,
        "User with this email already exists and is verified"
      );
    }

    if (existingUserByUsername) {
      throw new CustomError(400, "Username already taken");
    }

    // Check if device already exists (make this optional to prevent blocking)
    try {
      const existingDevice = await Device.findOne({ imei });
      if (existingDevice) {
        console.warn(`⚠️ Device with IMEI ${imei} already exists`);
        // Don't block registration, just log warning
      }
    } catch (deviceError) {
      console.error("Error checking existing device:", deviceError);
      // Continue with registration
    }

    // Check if phone number already has active subscription
    try {
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
    } catch (subscriptionError) {
      if (subscriptionError instanceof CustomError) {
        throw subscriptionError;
      }
      console.error("Error checking existing subscription:", subscriptionError);
      // Continue with registration
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Generate email verification token
    const verificationToken = generateVerificationToken();

    // Create new user with transaction-like approach
    let newUser, newDevice, newSubscription;

    try {
      // Create new user
      newUser = new User({
        username,
        email,
        password: hashedPassword,
        isEmailVerified: false,
        isActive: false,
        emailVerificationToken: verificationToken,
        emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      });

      await newUser.save();
      console.log(`✅ User created: ${newUser._id}`);

      // Generate TOTP secret and create device
      try {
        const totpSecret = generateRandomString(32);
        newDevice = new Device({
          user: newUser._id,
          imei,
          totpSecret,
          deviceName,
        });

        await newDevice.save();
        console.log(`✅ Device created: ${newDevice._id}`);
      } catch (deviceError) {
        console.error("Failed to create device:", deviceError);
        // Clean up user if device creation fails
        await User.findByIdAndDelete(newUser._id);
        throw new CustomError(
          500,
          "Failed to register device. Please try again."
        );
      }

      // Create subscription
      try {
        const subscriptionPrice = getSubscriptionPrice(plan);
        const startDate = new Date();
        const subscriptionDuration = getSubscriptionDuration(plan);
        const endDate = new Date(
          startDate.getTime() + subscriptionDuration * 24 * 60 * 60 * 1000
        );

        newSubscription = new Subscription({
          user: newUser._id,
          imei,
          phone: phoneNumber,
          email,
          plan,
          price: subscriptionPrice,
          cards: files,
          startDate,
          endDate,
          status: "PENDING",
        });

        await newSubscription.save();
        console.log(`✅ Subscription created: ${newSubscription._id}`);
      } catch (subscriptionError) {
        console.error("Failed to create subscription:", subscriptionError);
        // Clean up user and device if subscription creation fails
        await User.findByIdAndDelete(newUser._id);
        await Device.findByIdAndDelete(newDevice._id);
        throw new CustomError(
          500,
          "Failed to create subscription. Please try again."
        );
      }
    } catch (creationError) {
      console.error("Error during user creation process:", creationError);
      if (creationError instanceof CustomError) {
        throw creationError;
      }
      throw new CustomError(500, "Registration failed. Please try again.");
    }

    // Send verification email (don't fail registration if email fails)
    let emailSent = false;
    try {
      await sendVerificationEmail(email, verificationToken, username);
      console.log(`✅ Verification email sent to ${email}`);
      emailSent = true;
    } catch (emailError) {
      console.error("Failed to send verification email:", emailError);
      // Don't fail registration, just note that email failed
      emailSent = false;
    }

    // Send success response
    const responseData = {
      requiresVerification: true,
      email: newUser.email,
      username: newUser.username,
      message: emailSent
        ? "A verification email has been sent to your email address. Please click the link in the email to verify your account before logging in."
        : "Registration successful, but we couldn't send the verification email. Please contact support for manual verification.",
    };

    // Include upload warnings if any
    if (req.body.uploadWarnings && req.body.uploadWarnings.length > 0) {
      responseData.uploadWarnings = req.body.uploadWarnings;
    }

    res.status(201).json({
      success: true,
      message: emailSent
        ? "User registered successfully. Please check your email to verify your account."
        : "User registered successfully. Please contact support to verify your account.",
      data: responseData,
    });
  } catch (err) {
    console.error("Registration error:", err);

    // Handle different types of errors appropriately
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
    } else if (err.name === "MongoNetworkError") {
      // Database connection error
      next(
        new CustomError(
          500,
          "Database connection failed. Please try again later."
        )
      );
    } else if (err.code === "ENOTFOUND" || err.code === "ETIMEDOUT") {
      // Network errors
      next(
        new CustomError(
          500,
          "Network error. Please check your connection and try again."
        )
      );
    } else {
      // Generic server error
      next(
        new CustomError(
          500,
          "Registration failed due to server error. Please try again."
        )
      );
    }
  }
};

// Keep other methods the same but add similar error handling
const login = async (req, res, next) => {
  const { username, password } = req.body;

  try {
    // Find user by username or email
    let user = await User.findOne({
      $or: [{ email: username }, { username: username }],
    });

    if (!user) {
      throw new CustomError(401, "Invalid credentials");
    }

    // Check if email is verified
    if (!user.isEmailVerified) {
      return res.status(403).json({
        success: false,
        message:
          "Please verify your email address before logging in. Check your inbox for the verification link.",
        data: {
          requiresVerification: true,
          email: user.email,
        },
      });
    }

    // Check if account is active
    if (!user.isActive) {
      throw new CustomError(
        403,
        "Account is not active. Please contact support."
      );
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new CustomError(401, "Invalid credentials");
    }

    // Update login tracking (don't fail login if this fails)
    try {
      user.lastLoginAt = new Date();
      user.isOnline = true;
      user.lastSeen = new Date();
      await user.save();
    } catch (updateError) {
      console.error("Failed to update login tracking:", updateError);
      // Continue with login
    }

    // Create payload for JWT
    const payload = {
      user: {
        id: user.id,
      },
    };

    // Sign tokens
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    const refreshToken = jwt.sign(payload, process.env.REFRESH_SECRET, {
      expiresIn: "30d",
    });

    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.emailVerificationToken;
    delete userResponse.emailVerificationExpires;

    // Send response with token and user info
    res.json({
      success: true,
      message: "Login successful",
      data: {
        ...userResponse,
        accessToken,
        refreshToken,
      },
    });
  } catch (err) {
    console.error("Login error:", err);

    if (err instanceof CustomError) {
      next(err);
    } else if (err.name === "MongoNetworkError") {
      next(
        new CustomError(
          500,
          "Database connection failed. Please try again later."
        )
      );
    } else {
      next(new CustomError(500, "Login failed. Please try again."));
    }
  }
};

// Email verification endpoint with better error handling
const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      throw new CustomError(400, "Verification token is required");
    }

    // Find user by valid verification token
    const user = await User.findByValidVerificationToken(token);

    if (!user) {
      throw new CustomError(400, "Invalid or expired verification token");
    }

    // Activate user account
    await user.activateAccount();

    // Send welcome email (don't fail verification if email fails)
    try {
      await sendWelcomeEmail(user.email, user.username);
    } catch (emailError) {
      console.error("Failed to send welcome email:", emailError);
      // Don't fail the verification
    }

    res.json({
      success: true,
      message: "Email verified successfully! Your account is now active.",
      data: {
        verified: true,
        email: user.email,
        username: user.username,
      },
    });
  } catch (err) {
    console.error("Email verification error:", err);

    if (err instanceof CustomError) {
      next(err);
    } else if (err.name === "MongoNetworkError") {
      next(
        new CustomError(
          500,
          "Database connection failed. Please try again later."
        )
      );
    } else {
      next(new CustomError(500, "Verification failed. Please try again."));
    }
  }
};

// Resend verification email with error handling
const resendVerificationEmail = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new CustomError(400, "Email is required");
    }

    const user = await User.findOne({ email });

    if (!user) {
      throw new CustomError(404, "User not found");
    }

    if (user.isEmailVerified) {
      throw new CustomError(400, "Email is already verified");
    }

    // Generate new verification token
    const verificationToken = user.generateVerificationToken();
    await user.save();

    // Send verification email
    try {
      await sendVerificationEmail(email, verificationToken, user.username);

      res.json({
        success: true,
        message: "Verification email sent successfully",
        data: {
          email: user.email,
        },
      });
    } catch (emailError) {
      console.error("Failed to send verification email:", emailError);
      res.status(500).json({
        success: false,
        message:
          "Failed to send verification email. Please try again later or contact support.",
        error: "EMAIL_SEND_FAILED",
      });
    }
  } catch (err) {
    next(err);
  }
};

// Keep other methods the same...
const getUser = async (req, res, next) => {
  try {
    let user = await User.findById(req.user._id).select(
      "-password -emailVerificationToken"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const devices = await Device.find({ user: req.user._id });
    const subscriptions = await Subscription.find({ user: req.user._id });

    // Convert Mongoose document to plain object
    user = user.toObject();

    // Attach related data
    user.devices = devices;
    user.subscriptions = subscriptions;

    res.json({
      success: true,
      message: "User fetched successfully",
      data: user,
    });
  } catch (err) {
    next(err);
  }
};


const passUser = async (req, res, next) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    const payload = {
      user: {
        id: req.user._id.toString(),
      },
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
      (err, token) => {
        if (err) throw err;

        res.json({
          message: "Authentication successful",
          token,
          user,
        });
      }
    );
  } catch (err) {
    next(err);
  }
};

const logout = async (req, res, next) => {
  try {
    // Update user status if user is authenticated (don't fail logout if this fails)
    if (req.user) {
      try {
        await User.findByIdAndUpdate(req.user._id, {
          isOnline: false,
          lastSeen: new Date(),
        });
      } catch (updateError) {
        console.error("Failed to update logout status:", updateError);
        // Continue with logout
      }
    }

    res.json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  login,
  register,
  verifyEmail,
  resendVerificationEmail,
  getUser,
  passUser,
  logout,
};
