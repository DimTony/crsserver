const mongoose = require("mongoose");

const SubscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: String,
      required: true,
      ref: "User",
    },
    imei: {
      type: String,
      required: true,
    },
    deviceName: {
      type: String,
      required: true,
      default: "Device",
      trim: true,
      maxlength: [100, "Device name cannot exceed 100 characters"],
    },
    phone: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    plan: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      default: 0,
      min: [0, "Subscription price cannot be negative"],
    },
    cards: {
      type: [String],
      default: [],
    },
    queuePosition: {
      type: String,
      trim: true,
    },
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
    },
    status: {
      type: String,
      enum: {
        values: ["PENDING", "ACTIVE", "EXPIRED", "CANCELLED"],
        message: "Status must be one of: PENDING, ACTIVE, EXPIRED, CANCELLED",
      },
      required: [true, "Status is required"],
      default: "PENDING",
    },
  },
  { versionKey: false, timestamps: true }
);

module.exports = mongoose.model("Subscription", SubscriptionSchema);
