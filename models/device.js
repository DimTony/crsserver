const mongoose = require("mongoose");

const DeviceSchema = new mongoose.Schema(
  {
    user: {
      type: String,
      required: true,
      ref: "User",
      //   unique: true,
    },
    imei: {
      type: String,
      required: true,
      unique: true,
    },
    totpSecret: {
      type: String,
      required: true,
      //   unique: true,
    },
    isOnboarded: {
      type: Boolean,
      default: false,
    },
    deviceName: {
      type: String,
      required: true,
      default: "Device",
      trim: true,
      maxlength: [100, "Device name cannot exceed 100 characters"],
    },
  },
  { versionKey: false, timestamps: true }
);

module.exports = mongoose.model("Device", DeviceSchema);
