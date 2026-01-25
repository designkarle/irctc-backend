const express = require('express');
const router = express.Router();
const {sendOTP, verifyOTP, login, rotateRefreshToken} = require('../controllers/auth.controller');

router.post("/send-otp", sendOTP);
router.post("/verify-otp", verifyOTP);
router.post("/login", login);
router.get("/refresh", rotateRefreshToken);
module.exports = router;