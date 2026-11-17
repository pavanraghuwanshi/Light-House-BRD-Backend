import express from "express";
import {
  createCluster,
  getClusters,
  getDeletedClusters,
  getClusterById,
  getClusterAOMs,
  updateCluster,
  restoreCluster,
  deleteCluster,
} from "../Controllers/Cluster.Controller.js";
import authenticateUser from "../Middleware/authMiddleware.js";

const router = express.Router();

// List Trashed / Deleted Clusters (Central & National Head)
router.get("/clusters/deleted", authenticateUser, getDeletedClusters);

// Cluster Master Routes
router.post("/clusters", authenticateUser, createCluster);
router.get("/clusters", authenticateUser, getClusters);
router.get("/clusters/:id", authenticateUser, getClusterById);
router.get("/clusters/:id/aoms", authenticateUser, getClusterAOMs);
router.put("/clusters/:id", authenticateUser, updateCluster);
router.put("/clusters/:id/restore", authenticateUser, restoreCluster);
router.delete("/clusters/:id", authenticateUser, deleteCluster);

export default router;
