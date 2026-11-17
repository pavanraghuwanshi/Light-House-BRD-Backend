import express from "express";
import {
  createCluster,
  getClusters,
  getClusterById,
  getClusterAOMs,
  updateCluster,
  deleteCluster,
} from "../Controllers/Cluster.Controller.js";
import authenticateUser from "../Middleware/authMiddleware.js";

const router = express.Router();

// Cluster Master Routes
router.post("/clusters", authenticateUser, createCluster);
router.get("/clusters", authenticateUser, getClusters);
router.get("/clusters/:id", authenticateUser, getClusterById);
router.get("/clusters/:id/aoms", authenticateUser, getClusterAOMs);
router.put("/clusters/:id", authenticateUser, updateCluster);
router.delete("/clusters/:id", authenticateUser, deleteCluster);

export default router;
