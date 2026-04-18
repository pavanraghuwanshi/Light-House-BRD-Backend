import express from "express";
import {createAudit,finalizeAudit, getAudits, getFullAudit, deleteAudit} from "../Controllers/auditController/audit.Controller.js";

import { saveSection } from "../Controllers/auditController/allAuditSection.js";
import authenticateUser from "../Middleware/authMiddleware.js";

const router = express.Router();


// Create
router.post("/audit/create", authenticateUser, createAudit);

// Save Section (ALL FORMS)
router.post("/audit/section/save", authenticateUser, saveSection);

// Finalize
router.post("/finalize/:auditId", authenticateUser, finalizeAudit);

// Get
router.get("/audit", getAudits);
router.get("/:auditId", getFullAudit);

// Delete
router.delete("/:auditId", authenticateUser, deleteAudit);

export default router;