// config/fileHandler.js - Updated with better error handling
require("dotenv").config();
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");

// Cloudinary config
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
}).array("files", 10);

// Enhanced upload to Cloudinary with better error handling
const uploadToCloudinary = (fileBuffer, folder = "crs") => {
  return new Promise((resolve, reject) => {
    const uploadTimeout = setTimeout(() => {
      reject(new Error('Cloudinary upload timeout - please try again'));
    }, 30000); // 30 second timeout

    const stream = cloudinary.uploader.upload_stream(
      { 
        folder, 
        resource_type: "auto",
        timeout: 30000
      },
      (err, result) => {
        clearTimeout(uploadTimeout);
        
        if (err) {
          console.error('Cloudinary upload error:', err);
          
          // Handle specific Cloudinary errors
          if (err.code === 'ENOTFOUND') {
            reject(new Error('Network connection failed. Please check your internet connection and try again.'));
          } else if (err.code === 'ETIMEDOUT') {
            reject(new Error('Upload timeout. Please try again with smaller files.'));
          } else if (err.http_code === 401) {
            reject(new Error('Cloudinary authentication failed. Please check your configuration.'));
          } else if (err.http_code === 403) {
            reject(new Error('Cloudinary access denied. Please check your permissions.'));
          } else if (err.http_code === 413) {
            reject(new Error('File too large. Please upload smaller files.'));
          } else {
            reject(new Error(`File upload failed: ${err.message || 'Unknown error'}`));
          }
        } else {
          resolve(result.secure_url);
        }
      }
    );

    // Handle stream errors
    const readStream = streamifier.createReadStream(fileBuffer);
    readStream.on('error', (error) => {
      clearTimeout(uploadTimeout);
      reject(new Error(`File processing error: ${error.message}`));
    });

    readStream.pipe(stream);
  });
};

// Enhanced middleware with graceful error handling
const cloudinaryUploadMiddleware = async (req, res, next) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error("Multer upload error:", err);
      return res.status(400).json({ 
        success: false, 
        message: err.message,
        error: 'FILE_UPLOAD_ERROR'
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "No files uploaded",
        error: 'NO_FILES'
      });
    }

    try {
      const uploadedUrls = [];
      const uploadErrors = [];

      // Process uploads with individual error handling
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        try {
          console.log(`Uploading file ${i + 1}/${req.files.length}: ${file.originalname}`);
          const secureUrl = await uploadToCloudinary(file.buffer);
          uploadedUrls.push(secureUrl);
          console.log(`✅ File ${i + 1} uploaded successfully`);
        } catch (uploadErr) {
          console.error(`❌ Failed to upload file ${file.originalname}:`, uploadErr.message);
          uploadErrors.push({
            filename: file.originalname,
            error: uploadErr.message
          });
        }
      }

      // Check if any files were uploaded successfully
      if (uploadedUrls.length === 0) {
        return res.status(500).json({
          success: false,
          message: "All file uploads failed. Please check your internet connection and try again.",
          error: 'ALL_UPLOADS_FAILED',
          details: uploadErrors
        });
      }

      // If some files failed but some succeeded
      if (uploadErrors.length > 0) {
        console.warn(`⚠️ ${uploadErrors.length} file(s) failed to upload, ${uploadedUrls.length} succeeded`);
        req.body.uploadWarnings = uploadErrors;
      }

      req.body.files = uploadedUrls;
      console.log(`✅ Successfully uploaded ${uploadedUrls.length} file(s)`);
      next();

    } catch (generalErr) {
      console.error("General upload error:", generalErr);
      res.status(500).json({
        success: false,
        message: "File upload service temporarily unavailable. Please try again later.",
        error: 'UPLOAD_SERVICE_ERROR'
      });
    }
  });
};

// Enhanced mixed upload with error handling
const cloudinaryMixedUpload = (fieldsConfig = []) => {
  const multerUpload = upload.fields(fieldsConfig);

  return async (req, res, next) => {
    multerUpload(req, res, async (err) => {
      if (err) {
        console.error("Multer error:", err);
        return res.status(400).json({ 
          success: false, 
          message: err.message,
          error: 'MULTER_ERROR'
        });
      }

      try {
        const fileGroups = req.files || {};
        const uploadErrors = [];

        for (const field in fileGroups) {
          const urls = [];

          for (const file of fileGroups[field]) {
            try {
              const secureUrl = await uploadToCloudinary(file.buffer, field);
              urls.push(secureUrl);
            } catch (uploadErr) {
              console.error(`Failed to upload ${file.originalname}:`, uploadErr.message);
              uploadErrors.push({
                field,
                filename: file.originalname,
                error: uploadErr.message
              });
            }
          }

          req.body[field] = urls;
        }

        if (uploadErrors.length > 0) {
          req.body.uploadErrors = uploadErrors;
        }

        next();
      } catch (cloudErr) {
        console.error("Cloudinary mixed upload error:", cloudErr);
        res.status(500).json({
          success: false,
          message: "File upload service error",
          error: 'MIXED_UPLOAD_ERROR'
        });
      }
    });
  };
};

module.exports = { cloudinaryUploadMiddleware, cloudinaryMixedUpload };