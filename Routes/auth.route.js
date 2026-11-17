import express from 'express';
import { 
  loginUser, 
  resetPassword, 
  refreshTokenHandler, 
  logoutUser 
} from '../Controllers/User.Controller.js';

const router = express.Router();

// FR-1.1 & FR-1.6: Authentication with 15m Access Token & 30d Refresh Token
router.post("/login", loginUser);

// Refresh 15-minute access token using 30-day refresh token
router.post("/refresh-token", refreshTokenHandler);

// Logout and revoke refresh token
router.post("/logout", logoutUser);

// FR-1.4: Password reset (requires oldPassword and newPassword, username not required)
router.post("/reset-password", resetPassword);

export default router;

