import express from "express";
import {
  createZone,
  getZones,
  getZoneById,
  updateZone,
  deleteZone,
} from "../Controllers/Zone.Controller.js";
import authenticateUser from "../Middleware/authMiddleware.js";

const router = express.Router();

// Zone Master Routes
router.post("/zones", authenticateUser, createZone);
router.get("/zones", authenticateUser, getZones);
router.get("/zones/:id", authenticateUser, getZoneById);
router.put("/zones/:id", authenticateUser, updateZone);
router.delete("/zones/:id", authenticateUser, deleteZone);

export default router;
