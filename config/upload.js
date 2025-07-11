const dotenv = require("dotenv");
const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const fs = require("fs");
const os = require("os");
const path = require("path");

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, os.tmpdir()); // Use the system's temp directory
  },
  filename: function (req, file, cb) {
    cb(
      null,
      file.fieldname + "-" + Date.now() + path.extname(file.originalname)
    );
  },
});

const fileFilter = (req, file, cb) => {
  if (file.fieldname === "introVideo") {
    if (
      [
        "video/mp4",
        "video/quicktime",
        "video/x-msvideo",
        "video/x-ms-wmv",
        "video/x-flv",
        "video/webm",
        "video/x-matroska",
        "video/hevc",
      ].includes(file.mimetype)
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid video format. Allowed formats: MP4, MOV, AVI, WMV, FLV, WebM, MKV, HEVC"
        ),
        false
      );
    }
  } else if (file.fieldname === "files") {
    if (
      [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/bmp",
        "image/webp",
        "image/heic",
      ].includes(file.mimetype)
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid image format. Allowed formats: JPEG, PNG, GIF, BMP, WebP, HEIC"
        ),
        false
      );
    }
  } else {
    cb(new Error("Unexpected field"), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 2000 * 1024 * 1024, // 2 GB limit
  },
});

const allowedFileTypes = {
  pdf: ["application/pdf"],
  image: [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/bmp",
    "image/webp",
    "image/heic",
  ],
};

const allowedExtensions = {
  pdf: [".pdf"],
  image: [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic"],
};

// Define file size limits (in bytes)
const fileSizeLimits = {
  pdf: 500 * 1024 * 1024, // 500 MB
  image: 200 * 1024 * 1024, // 200 MB
};

const jarradFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (file.fieldname === "pdf") {
    if (
      allowedFileTypes.pdf.includes(file.mimetype) &&
      allowedExtensions.pdf.includes(ext)
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Invalid file type or extension for PDF. Received MIME type: ${file.mimetype}, Extension: ${ext}`
        ),
        false
      );
    }
  } else if (file.fieldname === "picture") {
    if (
      allowedFileTypes.image.includes(file.mimetype) &&
      allowedExtensions.image.includes(ext)
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Invalid image format. Allowed formats: JPEG, JPG, PNG, GIF, BMP, WebP, HEIC. Received MIME type: ${file.mimetype}, Extension: ${ext}`
        ),
        false
      );
    }
  } else {
    cb(new Error("Unexpected field name"), false);
  }
};

const jarradUpload = multer({
  storage: storage,
  fileFilter: jarradFileFilter,
  limits: {
    fileSize: Math.max(fileSizeLimits.pdf, fileSizeLimits.image),
  },
});

const uploadToCloudinary = async (file) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "farmer_wants_a_wife_applications",
        resource_type: "auto",
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    fs.createReadStream(file.path).pipe(uploadStream);
  });
};

const handleUpload = async (req, res, next) => {
  try {
    const files = Array.isArray(req.files)
      ? req.files // from upload.array(...)
      : Object.values(req.files || {}).flat(); // from upload.fields(...)

    for (const file of files) {
      const result = await uploadToCloudinary(file);
      // Attach the Cloudinary URL back to req.body
      if (!req.body[file.fieldname]) req.body[file.fieldname] = [];
      req.body[file.fieldname].push(result.secure_url);
      fs.unlinkSync(file.path); // Clean up temp file
    }

    next();
  } catch (error) {
    console.error("Upload handler error:", error);

    // Cleanup any remaining files
    const files = Array.isArray(req.files)
      ? req.files
      : Object.values(req.files || {}).flat();

    for (const file of files) {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }

    next(error);
  }
};


const jarradTicketstorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "jarrad_ticketuploads", // The folder in Cloudinary where you want to store the uploads
    allowed_formats: ["jpg", "png", , "heic", "webp", "gif", "jpeg", "pdf"], // Adjust as needed
  },
});

// const jarradTicketUpload = multer({ storage: jarradTicketstorage });

const jarradTicketFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (file.fieldname === "pdf") {
    if (
      allowedFileTypes.pdf.includes(file.mimetype) &&
      allowedExtensions.pdf.includes(ext)
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Invalid file type or extension for PDF. Received MIME type: ${file.mimetype}, Extension: ${ext}`
        ),
        false
      );
    }
  } else if (file.fieldname === "picture") {
    if (
      allowedFileTypes.image.includes(file.mimetype) &&
      allowedExtensions.image.includes(ext)
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Invalid image format. Allowed formats: JPEG, JPG, PNG, GIF, BMP, WebP, HEIC. Received MIME type: ${file.mimetype}, Extension: ${ext}`
        ),
        false
      );
    }
  } else {
    cb(new Error("Unexpected field name"), false);
  }
};

const jarradTicketUpload = multer({
  storage: storage,
  fileFilter: jarradFileFilter,
  limits: {
    fileSize: Math.max(fileSizeLimits.pdf, fileSizeLimits.image),
  },
});

module.exports = {
  upload,
  jarradUpload,
  handleUpload,
  jarradTicketUpload,
};
