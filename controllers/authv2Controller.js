// controllers/authController.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cloudinary = require("cloudinary").v2;
const User = require("../models/user"); // Adjust path as needed

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Helper function to upload file to Cloudinary
const uploadToCloudinary = async (buffer, originalName, mimetype) => {
  return new Promise((resolve, reject) => {
    const resourceType = mimetype.startsWith("image/") ? "image" : "raw";

    console.log("☁️ Uploading to Cloudinary:", {
      originalName,
      mimetype,
      resourceType,
      bufferSize: buffer.length,
    });

    cloudinary.uploader
      .upload_stream(
        {
          resource_type: resourceType,
          folder: "encryption-cards",
          public_id: `${Date.now()}_${originalName.split(".")[0]}`,
          quality: "auto",
          fetch_format: "auto",
        },
        (error, result) => {
          if (error) {
            console.error("❌ Cloudinary upload failed:", error);
            reject(error);
          } else {
            console.log("✅ Cloudinary upload successful:", {
              public_id: result.public_id,
              secure_url: result.secure_url,
              format: result.format,
              bytes: result.bytes,
            });
            resolve(result);
          }
        }
      )
      .end(buffer);
  });
};

// Generate JWT tokens
const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

  const refreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: "7d",
  });

  return { accessToken, refreshToken };
};

// Register/Create user
const register = async (req, res) => {
  try {
    console.log("📝 Registration request received");
    console.log("📋 Form fields:", req.body);
    console.log("📎 Files received:", req.files?.length || 0);

    // Extract and validate fields - handle multiple possible field names
    const {
      name,
      username,
      email,
      password,
      phone,
      phoneNumber,
      deviceName,
      imei,
      subscription,
      subscriptionPlan,
      termsAccepted,
    } = req.body;

    // Use fallback values for different field name variations
    const userData = {
      name: name || username,
      username: username || name,
      email,
      password,
      phoneNumber: phoneNumber || phone,
      deviceName,
      imei,
      subscriptionPlan: subscriptionPlan || subscription,
    };

    console.log("📋 Processed user data:", userData);

    // Validation - check all required fields
    const requiredFields = [
      "name",
      "username",
      "email",
      "password",
      "phoneNumber",
      "deviceName",
      "imei",
      "subscriptionPlan",
    ];
    const missingFields = requiredFields.filter((field) => !userData[field]);

    if (missingFields.length > 0) {
      console.log("❌ Missing required fields:", missingFields);
      return res.status(400).json({
        status: "fail",
        message: `Missing required fields: ${missingFields.join(", ")}`,
        missingFields,
      });
    }

    // Validate files
    if (!req.files || req.files.length === 0) {
      console.log("❌ No files uploaded");
      return res.status(400).json({
        status: "fail",
        message: "At least one encryption card file is required",
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email: userData.email }, { username: userData.username }],
    });

    if (existingUser) {
      console.log("❌ User already exists");
      return res.status(400).json({
        status: "fail",
        message: "User with this email or username already exists",
      });
    }

    console.log("☁️ Starting file uploads to Cloudinary...");

    // Upload files to Cloudinary
    const uploadPromises = req.files.map(async (file) => {
      try {
        const result = await uploadToCloudinary(
          file.buffer,
          file.originalname,
          file.mimetype
        );

        return {
          originalName: file.originalname,
          cloudinaryUrl: result.secure_url,
          cloudinaryPublicId: result.public_id,
          size: result.bytes,
          format: result.format,
          mimetype: file.mimetype,
          uploadedAt: new Date(),
        };
      } catch (error) {
        console.error(`❌ Failed to upload ${file.originalname}:`, error);
        throw new Error(
          `Failed to upload ${file.originalname}: ${error.message}`
        );
      }
    });

    const uploadedFiles = await Promise.all(uploadPromises);
    console.log("✅ All files uploaded successfully");

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(userData.password, saltRounds);

    // Create user object
    const newUser = new User({
      name: userData.name,
      username: userData.username,
      email: userData.email,
      password: hashedPassword,
      phoneNumber: userData.phoneNumber,
      deviceInfo: {
        deviceName: userData.deviceName,
        imei: userData.imei,
      },
      subscription: {
        plan: userData.subscriptionPlan,
        startDate: new Date(),
        status: "active",
      },
      encryptionCards: uploadedFiles,
      isOnline: true,
      lastSeen: new Date(),
      stats: {
        messageCount: 0,
        activeDevices: 1,
      },
    });

    // Save user to database
    const savedUser = await newUser.save();
    console.log("✅ User saved to database:", savedUser._id);

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(savedUser._id);

    // Prepare response (exclude password and sensitive data)
    const userResponse = {
      id: savedUser._id,
      name: savedUser.name,
      username: savedUser.username,
      email: savedUser.email,
      phoneNumber: savedUser.phoneNumber,
      deviceInfo: savedUser.deviceInfo,
      subscription: savedUser.subscription,
      encryptionCards: savedUser.encryptionCards.map((card) => ({
        originalName: card.originalName,
        cloudinaryUrl: card.cloudinaryUrl,
        size: card.size,
        format: card.format,
        uploadedAt: card.uploadedAt,
      })),
      isOnline: savedUser.isOnline,
      lastSeen: savedUser.lastSeen,
      createdAt: savedUser.createdAt,
      updatedAt: savedUser.updatedAt,
      stats: savedUser.stats,
      accessToken,
      refreshToken,
    };

    console.log("✅ User created successfully:", {
      userId: savedUser._id,
      username: savedUser.username,
      email: savedUser.email,
      filesUploaded: uploadedFiles.length,
    });

    res.status(201).json({
      success: true,
      status: "success",
      message: "User created successfully",
      data: userResponse,
    });
  } catch (error) {
    console.error("💥 Registration error:", error);

    // Clean up uploaded files on error
    if (req.files && req.files.length > 0) {
      console.log("🧹 Cleaning up uploaded files due to error...");
      req.files.forEach(async (file) => {
        try {
          // Extract public_id from any uploaded files and delete from Cloudinary
          // This would require tracking which files were successfully uploaded
          console.log("🧹 Cleanup needed for:", file.originalname);
        } catch (cleanupError) {
          console.error("Cleanup error:", cleanupError);
        }
      });
    }

    res.status(500).json({
      success: false,
      status: "error",
      message: error.message || "Failed to create user",
      error: {
        message: error.message,
        status: "fail",
        statusCode: 500,
        isOperational: true,
      },
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

// Login user
const login = async (req, res) => {
  try {
    console.log("🔐 Login request received");
    const { username, email, password } = req.body;

    // Allow login with either username or email
    const loginIdentifier = username || email;

    if (!loginIdentifier || !password) {
      return res.status(400).json({
        success: false,
        status: "fail",
        message: "Username/email and password are required",
      });
    }

    // Find user by username or email
    const user = await User.findOne({
      $or: [{ username: loginIdentifier }, { email: loginIdentifier }],
    });

    if (!user) {
      console.log("❌ User not found:", loginIdentifier);
      return res.status(401).json({
        success: false,
        status: "fail",
        message: "Invalid credentials",
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      console.log("❌ Invalid password for user:", loginIdentifier);
      return res.status(401).json({
        success: false,
        status: "fail",
        message: "Invalid credentials",
      });
    }

    // Update user status
    user.isOnline = true;
    user.lastSeen = new Date();
    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id);

    console.log("✅ Login successful for user:", loginIdentifier);

    // Prepare response
    const userResponse = {
      id: user._id,
      name: user.name,
      username: user.username,
      email: user.email,
      phoneNumber: user.phoneNumber,
      deviceInfo: user.deviceInfo,
      subscription: user.subscription,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      stats: user.stats,
      accessToken,
      refreshToken,
    };

    res.json({
      success: true,
      status: "success",
      message: "Login successful",
      data: userResponse,
    });
  } catch (error) {
    console.error("💥 Login error:", error);
    res.status(500).json({
      success: false,
      status: "error",
      message: "Login failed",
      error: {
        message: error.message,
        status: "fail",
        statusCode: 500,
        isOperational: true,
      },
    });
  }
};

// Logout user
const logout = async (req, res) => {
  try {
    const userId = req.user?.id || req.userId;

    if (userId) {
      // Update user status
      await User.findByIdAndUpdate(userId, {
        isOnline: false,
        lastSeen: new Date(),
      });
    }

    console.log("✅ Logout successful for user:", userId);

    res.json({
      success: true,
      status: "success",
      message: "Logout successful",
    });
  } catch (error) {
    console.error("💥 Logout error:", error);
    res.status(500).json({
      success: false,
      status: "error",
      message: "Logout failed",
    });
  }
};

module.exports = {
  register,
  login,
  logout,
};
