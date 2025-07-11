const express = require("express");
const router = express.Router();
const {
//   register,
//   login,
//   getUser,
  getProfile,
} = require("../controllers/userController");
const { auth } = require("../middleware/auth");

// router.post(
//   "/create",
//   upload.array("files", 10), // Accept up to 10 files under the "photos" field
//   handleUpload,
//   register
// );
// router.post("/login", login);
// router.get("/user", auth, getUser);
router.get("/profile", auth, getProfile);

module.exports = router;
