import express from 'express';
import {
  addAdmin,
  loginUser,
  resetPassword,
  createPrekUser,
  getPrekUsers,
  updatePrekUser,
  unlockPrekUser,
  adminResetPassword,
  NotificationOnOff,
  storeFcmToken,
  toggleAccountActivation,
} from '../Controllers/User.Controller.js';
import authenticateUser from '../Middleware/authMiddleware.js';

const router = express.Router();

// Authentication (FR-1.1, FR-1.6)
router.post("/login", loginUser);

// Self-service password reset (FR-1.4)
router.post("/reset-password", resetPassword);

// Legacy admin
router.post("/superadmin", addAdmin);
router.post("/fcmtoken/store", authenticateUser, storeFcmToken);
router.post("/notification/on-off", authenticateUser, NotificationOnOff);
router.put("/user/deactivate/:id", authenticateUser, toggleAccountActivation);

// Pre-K User Administration (FR-1.4, FR-1.6)
router.post("/prek-users", authenticateUser, createPrekUser);
router.get("/prek-users", authenticateUser, getPrekUsers);
router.put("/prek-users/:id", authenticateUser, updatePrekUser);
router.put("/prek-users/:id/unlock", authenticateUser, unlockPrekUser);
router.put("/prek-users/:id/reset-password", authenticateUser, adminResetPassword);

export default router;
