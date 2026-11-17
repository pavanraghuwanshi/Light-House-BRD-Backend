import express from "express";
import {
  createCentre,
  getCentres,
  getDeletedCentres,
  getCentreById,
  updateCentre,
  restoreCentre,
  deleteCentre,
} from "../Controllers/Centre.Controller.js";
import authenticateUser from "../Middleware/authMiddleware.js";

const router = express.Router();

// List Trashed / Deleted Centres (Central & National Head)
router.get("/centres/deleted", authenticateUser, getDeletedCentres);

// Centre / School Master Routes
router.post("/centres", authenticateUser, createCentre);
router.get("/centres", authenticateUser, getCentres);
router.get("/centres/:id", authenticateUser, getCentreById);
router.put("/centres/:id", authenticateUser, updateCentre);
router.put("/centres/:id/restore", authenticateUser, restoreCentre);
router.delete("/centres/:id", authenticateUser, deleteCentre);

export default router;
