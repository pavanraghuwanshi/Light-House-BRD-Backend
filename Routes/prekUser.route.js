import express from 'express';
import {
  createPrekUser,
  getPrekUsers,
  updatePrekUser,
  unlockPrekUser,
  adminResetPassword,
} from '../Controllers/User.Controller.js';
import authenticateUser from '../Middleware/authMiddleware.js';

const router = express.Router();

// Central Administrator User Management Endpoints (FR-1.4, FR-1.6)
router.post("/prek-users", authenticateUser, createPrekUser);
router.get("/prek-users", authenticateUser, getPrekUsers);
router.put("/prek-users/:id", authenticateUser, updatePrekUser);
router.put("/prek-users/:id/unlock", authenticateUser, unlockPrekUser);
router.put("/prek-users/:id/reset-password", authenticateUser, adminResetPassword);

export default router;
