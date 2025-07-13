const mongoose = require("mongoose");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const jwt = require("jsonwebtoken");
const Transaction = require("../models/transaction");
const Device = require("../models/device");
const Subscription = require("../models/subscription");
const {
  getSubscriptionPrice,
  getSubscriptionDuration,
} = require("../utils/helpers");
const CustomError = require("../utils/customError");


const SUBSCRIPTION_TYPES = {
  "mobile-v4-basic": 30,
  "mobile-v4-premium": 60,
  "mobile-v4-enterprise": 90,
  "mobile-v5-basic": 30,
  "mobile-v5-premium": 60,
  "full-suite-basic": 60,
  "full-suite-premium": 90,
};

const checkDeviceIsOnboarded = async (req, res, next) => {
  console.log("[checkDeviceIsOnboarded SERVER]:", req.body);
  const { imei } = req.body;
  const userId = req.user._id;

  const session = await mongoose.startSession();

  try {
    if (!imei) {
      throw new CustomError(400, "Please provide all valid IMEI");
    }

    await session.startTransaction();

    const existingDeviceByImei = await Device.findOne({
      user: userId,
      imei,
    }).session(session);

    return res.status(200).json({
      success: true,
      message: "Onboarding status fetched successfully",
      data: {
        isOnboarded: existingDeviceByImei?.isOnboarded || false,
        deviceExists: !!existingDeviceByImei,
      },
    });
  } catch (err) {
    // Abort transaction on any error
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("❌ Transaction aborted due to error");
    }

    console.error("Device check error:", err);

    if (err instanceof CustomError) {
      next(err);
    } else if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      next(new CustomError(400, `${field} already exists`));
    } else if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      next(new CustomError(400, messages.join(", ")));
    } else if (err.name === "MongoNetworkError") {
      next(
        new CustomError(
          500,
          "Database connection failed. Please try again later."
        )
      );
    } else if (err.code === "ENOTFOUND" || err.code === "ETIMEDOUT") {
      next(
        new CustomError(
          500,
          "Network error. Please check your connection and try again."
        )
      );
    } else {
      next(
        new CustomError(
          500,
          "Device check failed due to server error. Please try again."
        )
      );
    }
  } finally {
    // End session
    await session.endSession();
  }
};

const setupDeviceOtp = async (req, res, next) => {
  console.log("[setupDeviceOtp SERVER]:", req.body);
  const { imei, deviceName } = req.body;
  const userId = req.user._id;

  const session = await mongoose.startSession();

  try {
    if (!imei || !deviceName) {
      throw new CustomError(400, "Please provide all required fields");
    }

    await session.startTransaction();

    const secret = speakeasy.generateSecret({
      name: `${req.user.email} (${imei.slice(-4)})`,
      issuer: "CRS",
      length: 20,
    });

    await Device.findOneAndUpdate(
      { user: req.user._id, imei },
      {
        user: req.user._id,
        imei,
        totpSecret: secret.base32,
        deviceName: deviceName || "Mobile Device",
        isOnboarded: false,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    return res.status(200).json({
      success: true,
      message: "Device Setup Initiated successfully",
      data: {
        qrCode: qrCodeUrl,
        secret: secret.base32,
      },
    });
  } catch (err) {
    // Abort transaction on any error
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("❌ Transaction aborted due to error");
    }

    console.error("Device setup error:", err);

    if (err instanceof CustomError) {
      next(err);
    } else if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      next(new CustomError(400, `${field} already exists`));
    } else if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      next(new CustomError(400, messages.join(", ")));
    } else if (err.name === "MongoNetworkError") {
      next(
        new CustomError(
          500,
          "Database connection failed. Please try again later."
        )
      );
    } else if (err.code === "ENOTFOUND" || err.code === "ETIMEDOUT") {
      next(
        new CustomError(
          500,
          "Network error. Please check your connection and try again."
        )
      );
    } else {
      next(
        new CustomError(
          500,
          "Device set up failed due to server error. Please try again."
        )
      );
    }
  } finally {
    // End session
    await session.endSession();
  }
};

const queueSubscription = async (req, res, next) => {
  console.log("[queueSubscription SERVER]:", req.body);
  const { subscriptionId } = req.body;

  const session = await mongoose.startSession();

  try {
    if (!subscriptionId) {
      throw new CustomError(400, "Please provide all required fields");
    }

    await session.startTransaction();

    

    const updatedSubscription = await Subscription.findByIdAndUpdate(
      subscriptionId,
      {
        status: 'QUEUED',
        updatedAt: now,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (!updatedDevice) {
      throw new CustomError(400, "Device not updated");
    }

    res.json({
      success: true,
      message: "Subscription activated successfully",
      data: {
        subscription: updatedSubscription,
        duration: `${duration} days`,
        subscriptionType: subscriptionType,
      },
    });
  } catch (err) {
    // Abort transaction on any error
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("❌ Transaction aborted due to error");
    }

    console.error("Device setup error:", err);

    if (err instanceof CustomError) {
      next(err);
    } else if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      next(new CustomError(400, `${field} already exists`));
    } else if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      next(new CustomError(400, messages.join(", ")));
    } else if (err.name === "MongoNetworkError") {
      next(
        new CustomError(
          500,
          "Database connection failed. Please try again later."
        )
      );
    } else if (err.code === "ENOTFOUND" || err.code === "ETIMEDOUT") {
      next(
        new CustomError(
          500,
          "Network error. Please check your connection and try again."
        )
      );
    } else {
      next(
        new CustomError(
          500,
          "Device set up failed due to server error. Please try again."
        )
      );
    }
  } finally {
    // End session
    await session.endSession();
  }
}

const activateSubscription = async (req, res, next) => {
  console.log("[activateSubscription SERVER]:", req.body);
  const { subscriptionId, imei, totpCode } = req.body;
  const userId = req.user._id;

  const session = await mongoose.startSession();

  try {
    if (!imei || !subscriptionId || !totpCode) {
      throw new CustomError(400, "Please provide all required fields");
    }

    await session.startTransaction();

    const subscription = await Subscription.findById(subscriptionId).session(session);

    if (!subscription) {
      throw new CustomError(404, "Subscription not found");
    }

    console.log("AAA", req.user);
    console.log("GGG", subscription);

    if (subscription.user.toString() !== req.user._id.toString()) {
      throw new CustomError(403, "Unauthorized access to subscription");
    }

    if (subscription.status !== "QUEUED") {
      throw new CustomError(400, "Subscription not queued");
    }

    if (subscription.imei !== imei) {
      throw new CustomError(400, "Invalid IMEI");
    }

    const device = await Device.findOne({
      user: userId,
      imei,
    }).session(session);

    if (!device) {
      throw new CustomError(404, "Device not found");
    }

    const verified = speakeasy.totp.verify({
      secret: device.totpSecret,
      encoding: "base32",
      token: totpCode,
      window: 2, // Allow 2 time steps before/after current time
    });

    if (!verified) {
      throw new CustomError(400, "Invalid OTP");
    }

    const subscriptionType = subscription.subscriptionType;
    const durationInDays = SUBSCRIPTION_TYPES[subscriptionType];

    if (!durationInDays) {
      console.warn(
        `Unknown subscription type: ${subscriptionType}, defaulting to 30 days`
      );
    }

    const duration = durationInDays || 30;

    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + duration);

    const updatedSubscription = await Subscription.findByIdAndUpdate(
      subscriptionId,
      {
        status: "ACTIVE",
        startDate: now,
        endDate: endDate,
        updatedAt: now,
      }
    );

    const updatedDevice = await Device.findByIdAndUpdate(
      device._id,
      {
        isOnboarded: true,
        updatedAt: now,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (!updatedDevice) {
      throw new CustomError(400, "Device not updated");
    }

    res.json({
      success: true,
      message: "Subscription activated successfully",
      data: {
        subscription: updatedSubscription,
        duration: `${duration} days`,
        subscriptionType: subscriptionType,
      },
    });
  } catch (err) {
    // Abort transaction on any error
    if (session.inTransaction()) {
      await session.abortTransaction();
      console.log("❌ Transaction aborted due to error");
    }

    console.error("Device setup error:", err);

    if (err instanceof CustomError) {
      next(err);
    } else if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      next(new CustomError(400, `${field} already exists`));
    } else if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      next(new CustomError(400, messages.join(", ")));
    } else if (err.name === "MongoNetworkError") {
      next(
        new CustomError(
          500,
          "Database connection failed. Please try again later."
        )
      );
    } else if (err.code === "ENOTFOUND" || err.code === "ETIMEDOUT") {
      next(
        new CustomError(
          500,
          "Network error. Please check your connection and try again."
        )
      );
    } else {
      next(
        new CustomError(
          500,
          "Device set up failed due to server error. Please try again."
        )
      );
    }
  } finally {
    // End session
    await session.endSession();
  }
};

// Upgrade subscription
const upgradeSubscription = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { newPlan } = req.body;
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId,
      status: "ACTIVE",
    });

    if (!subscription) {
      throw new CustomError(404, "Active subscription not found");
    }

    const oldPlan = subscription.plan;
    const oldPrice = subscription.price;
    const newPrice = getSubscriptionPrice(newPlan);

    if (newPrice <= oldPrice) {
      throw new CustomError(400, "New plan must be higher tier");
    }

    // Calculate prorated amount
    const remainingDays = Math.ceil(
      (subscription.endDate - new Date()) / (1000 * 60 * 60 * 24)
    );
    const proratedAmount = newPrice - oldPrice;

    // Create upgrade transaction
    const transaction = new Transaction({
      user: userId,
      subscription: subscriptionId,
      transactionId: Transaction.generateTransactionId(),
      type: "SUBSCRIPTION_UPGRADED",
      amount: proratedAmount,
      plan: newPlan,
      status: "PENDING",
      metadata: {
        oldPlan,
        newPlan,
        proratedDays: remainingDays,
        fullNewPrice: newPrice,
        oldPrice,
      },
    });

    await transaction.save();

    // Update subscription
    subscription.plan = newPlan;
    subscription.price = newPrice;

    // Extend end date based on new plan duration
    const newDuration = getSubscriptionDuration(newPlan);
    subscription.endDate = new Date(
      subscription.startDate.getTime() + newDuration * 24 * 60 * 60 * 1000
    );

    await subscription.save();

    // Mark transaction as completed
    await transaction.updateStatus("COMPLETED", {
      completedAt: new Date(),
    });

    res.json({
      success: true,
      message: "Subscription upgraded successfully",
      subscription,
      transaction,
      proratedAmount,
    });
  } catch (err) {
    next(err);
  }
};

// Downgrade subscription
const downgradeSubscription = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { newPlan } = req.body;
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId,
      status: "ACTIVE",
    });

    if (!subscription) {
      throw new CustomError(404, "Active subscription not found");
    }

    const oldPlan = subscription.plan;
    const newPrice = getSubscriptionPrice(newPlan);

    // Create downgrade transaction (no immediate charge)
    const transaction = new Transaction({
      user: userId,
      subscription: subscriptionId,
      transactionId: Transaction.generateTransactionId(),
      type: "SUBSCRIPTION_DOWNGRADED",
      amount: 0, // No immediate charge for downgrade
      plan: newPlan,
      status: "COMPLETED",
      metadata: {
        oldPlan,
        newPlan,
        effectiveDate: subscription.endDate, // Takes effect at next billing cycle
        newPrice,
      },
      completedAt: new Date(),
    });

    await transaction.save();

    // Schedule the downgrade for next billing cycle
    subscription.pendingPlanChange = {
      newPlan,
      newPrice,
      effectiveDate: subscription.endDate,
    };

    await subscription.save();

    res.json({
      success: true,
      message: "Subscription downgrade scheduled for next billing cycle",
      subscription,
      transaction,
      effectiveDate: subscription.endDate,
    });
  } catch (err) {
    next(err);
  }
};

// Cancel subscription
const cancelSubscription = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { reason, immediate = false } = req.body;
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId,
      status: "ACTIVE",
    });

    if (!subscription) {
      throw new CustomError(404, "Active subscription not found");
    }

    const transaction = new Transaction({
      user: userId,
      subscription: subscriptionId,
      transactionId: Transaction.generateTransactionId(),
      type: "SUBSCRIPTION_CANCELLED",
      amount: 0,
      plan: subscription.plan,
      status: "COMPLETED",
      metadata: {
        cancellationReason: reason,
        immediate,
        originalEndDate: subscription.endDate,
      },
      completedAt: new Date(),
    });

    await transaction.save();

    if (immediate) {
      subscription.status = "CANCELLED";
      subscription.endDate = new Date();
    } else {
      subscription.cancelledAt = new Date();
      subscription.cancellationReason = reason;
      // Subscription remains active until end date
    }

    await subscription.save();

    res.json({
      success: true,
      message: immediate
        ? "Subscription cancelled immediately"
        : "Subscription will end at the current billing cycle",
      subscription,
      transaction,
    });
  } catch (err) {
    next(err);
  }
};

// Renew expired subscription
const renewSubscription = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user: userId,
      status: "EXPIRED",
    });

    if (!subscription) {
      throw new CustomError(404, "Expired subscription not found");
    }

    // Create renewal transaction
    const transaction = new Transaction({
      user: userId,
      subscription: subscriptionId,
      transactionId: Transaction.generateTransactionId(),
      type: "SUBSCRIPTION_ACTIVATED",
      amount: subscription.price,
      plan: subscription.plan,
      status: "PENDING",
    });

    await transaction.save();

    // This would typically integrate with payment processing
    // For now, we'll mark as completed
    await transaction.updateStatus("COMPLETED", {
      completedAt: new Date(),
    });

    // Reactivate subscription
    const duration = getSubscriptionDuration(subscription.plan);
    subscription.status = "ACTIVE";
    subscription.startDate = new Date();
    subscription.endDate = new Date(
      Date.now() + duration * 24 * 60 * 60 * 1000
    );
    subscription.cancelledAt = null;
    subscription.cancellationReason = null;

    await subscription.save();

    res.json({
      success: true,
      message: "Subscription renewed successfully",
      subscription,
      transaction,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  upgradeSubscription,
  downgradeSubscription,
  cancelSubscription,
  renewSubscription,
  checkDeviceIsOnboarded,
  setupDeviceOtp,
  activateSubscription,
};
