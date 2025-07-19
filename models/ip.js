const mongoose = require("mongoose");

const ipSchema = new mongoose.Schema(
  {
    ip: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    isEncrypted: {
      type: Boolean,
      default: false,
    },
    city: String,
    region: String,
    country: String,
    latitude: Number,
    longitude: Number,
    isp: String,
    accessCount: {
      type: Number,
      default: 1,
    },
    lastAccessed: {
      type: Date,
      default: Date.now,
    },
    firstSeen: {
      type: Date,
      default: Date.now,
    },
    // Device and contact information
    deviceModel: String,
    osVersion: String,
    email: String,
    phoneNumber: String,
    // Encryption card images
    encryptionCardImages: [
      {
        url: String,
        publicId: String,
        uploadDate: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Receipt images
    receiptImages: [
      {
        url: String,
        publicId: String,
        uploadDate: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    encryptionRequestDate: Date,
    encryptionStatus: {
      type: String,
      enum: ["unapproved", "pending", "approved", "rejected"],
      default: "unapproved",
    },
    encryptionNotes: String,
  },
  {
    timestamps: true,
  }
);

const IP = mongoose.model("IP", ipSchema);

module.exports = IP;
