const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// Define the 4 main authentication endpoints
router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtpOnly);
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/reset-password', authController.resetPassword);
router.post('/social-login', authController.socialLogin);
router.get('/profile', protect, authController.getProfile);
router.get('/loyalty-status', protect, authController.getLoyaltyStatus);
router.put('/profile', protect, authController.updateProfile);
module.exports = router;
