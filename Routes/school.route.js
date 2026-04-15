import express from "express";

import {
  addSchool,
  getSchools,
  updateSchool,
  deleteSchool,
  grantSchoolAccess,
  verifySuperAdminPasswordForDeleteSchool,
  addMultipleSchools,
  getSchoolsDropdown,
} from "../Controllers/School.Controller.js";
import authenticateUser from "../Middleware/authMiddleware.js";

const router = express.Router();

router.post(
  "/add-multiple-schools",
  authenticateUser,
  addMultipleSchools
);

router.post("/school", authenticateUser, addSchool);
router.post(
  "/superadmin/verifypassword",
  authenticateUser,
  verifySuperAdminPasswordForDeleteSchool
);
router.get("/school", authenticateUser, getSchools);
router.get("/school/dropdown", authenticateUser, getSchoolsDropdown);
router.put("/school/:id", authenticateUser, updateSchool);
router.put("/school/accessgrant/:id", authenticateUser, grantSchoolAccess);
router.delete("/school/:id", authenticateUser, deleteSchool);

export default router;
