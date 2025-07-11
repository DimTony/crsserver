const express = require("express");
const router = express.Router();
const {
  register,
  login,
  getUser,
  passUser,
  logout,
} = require("../controllers/authController");
const { auth } = require("../middleware/auth");
const { cloudinaryUploadMiddleware } = require("../config/fileHandler");

router.post(
  "/create",
  cloudinaryUploadMiddleware,
  register
);
router.post("/login", login);
router.get("/user", auth, getUser);
router.get("/", auth, passUser);
router.post("/logout", logout);

module.exports = router;
