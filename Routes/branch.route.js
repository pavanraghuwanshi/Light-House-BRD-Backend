import express from "express";
import multer from "multer";
import {  addBranch,getBranches,updateBranch,deleteBranch,grantSchoolBranchAccess,addMultipleBranches,getBranchesDropdown,getTodayExpiredBranches,  } from "../Controllers/Branch.Controller.js";
import authenticateUser from "../Middleware/authMiddleware.js";

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();
router.post("/add-multiple-branches/:id?", authenticateUser, upload.any(), addMultipleBranches);
router.post("/branch", authenticateUser, addBranch);
router.get("/branch", authenticateUser, getBranches);
router.get("/branch/dropdown", authenticateUser, getBranchesDropdown);
router.put("/branch/:id", authenticateUser, updateBranch);
router.put("/branch/accessgrant/:id", authenticateUser, grantSchoolBranchAccess);
router.delete("/branch/:id", authenticateUser, deleteBranch);


router.get("/branch/subscription/expired", authenticateUser, getTodayExpiredBranches);

export default router;
