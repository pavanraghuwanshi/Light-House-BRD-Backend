import express from "express";
import {
  createZone,
  getZones,
  getDeletedZones,
  getZoneById,
  updateZone,
  restoreZone,
  deleteZone,
} from "../Controllers/Zone.Controller.js";
import authenticateUser from "../Middleware/authMiddleware.js";

const router = express.Router();

// List Trashed / Deleted Zones (Central & National Head)
router.get("/zones/deleted", authenticateUser, getDeletedZones);

// Zone Master Routes
router.post("/zones", authenticateUser, createZone);
router.get("/zones", authenticateUser, getZones);
router.get("/zones/:id", authenticateUser, getZoneById);
router.put("/zones/:id", authenticateUser, updateZone);
router.put("/zones/:id/restore", authenticateUser, restoreZone);
router.delete("/zones/:id", authenticateUser, deleteZone);

export default router;
