import express from 'express';
import {
  createUser,
  getUsers,
  updateUser,
  unlockUser,
  adminResetPassword,
  toggleUserActivation,
  refreshTokenHandler,
  logoutUser,
} from '../Controllers/User.Controller.js';
import authenticateUser from '../Middleware/authMiddleware.js';

const router = express.Router();

// Refresh token & logout endpoints available on /api
router.post("/refresh-token", refreshTokenHandler);
router.post("/logout", logoutUser);

// FR-1.4: User Provisioning (Central Admin Only)
router.post("/users", authenticateUser, createUser);

// FR-1.4: List Users (Central & National Head)
router.get("/users", authenticateUser, getUsers);

// FR-1.4: Update User Assignment (Role, Zone, Cluster, Centres)
router.put("/users/:id", authenticateUser, updateUser);

// FR-1.6: Administrator Unlock Account
router.put("/users/:id/unlock", authenticateUser, unlockUser);

// FR-1.4: Administrator Password Reset
router.put("/users/:id/reset-password", authenticateUser, adminResetPassword);

// FR-1.4: Activate / Deactivate Account
router.put("/users/:id/status", authenticateUser, toggleUserActivation);

export default router;

