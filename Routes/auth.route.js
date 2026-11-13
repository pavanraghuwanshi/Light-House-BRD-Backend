import express from 'express';
import { loginUser, resetPassword } from '../Controllers/User.Controller.js';

const router = express.Router();

// FR-1.1 & FR-1.6: Authentication with 5-attempt account lockout
router.post("/login", loginUser);

// FR-1.4: Self-service password reset
router.post("/reset-password", resetPassword);

export default router;

