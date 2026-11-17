import express from "express";
import {
  createCentre,
  getCentres,
  getCentreById,
  updateCentre,
  deleteCentre,
} from "../Controllers/Centre.Controller.js";
import authenticateUser from "../Middleware/authMiddleware.js";

const router = express.Router();

// Centre / School Master Routes
router.post("/centres", authenticateUser, createCentre);
router.get("/centres", authenticateUser, getCentres);
router.get("/centres/:id", authenticateUser, getCentreById);
router.put("/centres/:id", authenticateUser, updateCentre);
router.delete("/centres/:id", authenticateUser, deleteCentre);

export default router;
