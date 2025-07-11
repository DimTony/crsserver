// middlewares/cloudinaryUpload.js
require("dotenv").config();
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");

// Cloudinary config (make sure your env variables are set)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Use memory storage so we can access file buffers
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 10,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/gif",
      "application/pdf",
    ];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Invalid file type"), false);
  },
}).array("files", 10); // Accept up to 10 files in field "files"

const mixedUpload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "application/pdf",
    ];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Invalid file type"), false);
  },
});

// 📥 Helper: Upload single buffer to Cloudinary
const mixedUploadToCloudinary = (fileBuffer, folder = "uploads") => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "auto" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
};

const uploadToCloudinary = (fileBuffer, folder = "uploads") => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "auto" },
      (err, result) => {
        if (err) reject(err);
        else resolve(result.secure_url);
      }
    );
    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
};

const cloudinaryUploadMiddleware = async (req, res, next) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error("Multer upload error:", err);
      return res.status(400).json({ success: false, message: err.message });
    }

    if (!req.files || req.files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No files uploaded" });
    }

    try {
      const uploadedUrls = [];

      for (const file of req.files) {
        const secureUrl = await uploadToCloudinary(file.buffer);
        uploadedUrls.push(secureUrl);
      }

      req.body.files = uploadedUrls; // ✅ Attach to req.body
      next();
    } catch (uploadErr) {
      console.error("Cloudinary upload failed:", uploadErr);
      res.status(500).json({
        success: false,
        message: "Failed to upload files to Cloudinary",
        error: uploadErr.message,
      });
    }
  });
};

/**
 * Middleware to handle multiple fields with different names
 *
 * @param {Array<{ name: string, maxCount?: number }>} fieldsConfig
 */
const cloudinaryMixedUpload = (fieldsConfig = []) => {
  const multerUpload = upload.fields(fieldsConfig);

  return async (req, res, next) => {
    multerUpload(req, res, async (err) => {
      if (err) {
        console.error("Multer error:", err);
        return res.status(400).json({ success: false, message: err.message });
      }

      try {
        const fileGroups = req.files || {};

        for (const field in fileGroups) {
          const urls = [];

          for (const file of fileGroups[field]) {
            const secureUrl = await uploadToCloudinary(file.buffer, field); // folder = field name
            urls.push(secureUrl);
          }

          // Attach array of URLs to req.body.<field>
          req.body[field] = urls;
        }

        next();
      } catch (cloudErr) {
        console.error("Cloudinary error:", cloudErr);
        res.status(500).json({
          success: false,
          message: "Cloudinary upload failed",
          error: cloudErr.message,
        });
      }
    });
  };
};

module.exports = {cloudinaryUploadMiddleware, cloudinaryMixedUpload};
