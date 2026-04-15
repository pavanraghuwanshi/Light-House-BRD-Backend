import express from "express";
import {  addBranch,getBranches,updateBranch,deleteBranch,grantSchoolBranchAccess,addMultipleBranches,getBranchesDropdown,getTodayExpiredBranches,  } from "../Controllers/Branch.Controller.js";
import authenticateUser from "../Middleware/authMiddleware.js";

const router = express.Router();
router.post("/add-multiple-branches/:id",authenticateUser,addMultipleBranches);
router.post("/branch", authenticateUser, addBranch);
router.get("/branch", authenticateUser, getBranches);
router.get("/branch/dropdown", authenticateUser, getBranchesDropdown);
router.put("/branch/:id", authenticateUser, updateBranch);
router.put("/branch/accessgrant/:id", authenticateUser, grantSchoolBranchAccess);
router.delete("/branch/:id", authenticateUser, deleteBranch);


router.get("/branch/subscription/expired", authenticateUser, getTodayExpiredBranches);

export default router;
