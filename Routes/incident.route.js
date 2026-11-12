import express from 'express';
const router = express.Router();

import { 
  addIncident, 
  getIncidents, 
  updateIncident, 
  deleteIncident, 
  updateIncidentStatus,
  getIncidentDashboard,
  getNationalDashboard,
  getEscalationMatrixReference,
  getAuditLogs
} from '../Controllers/Incident.Controller.js';

import authenticateUser from '../Middleware/authMiddleware.js';

// Incident Reporting & Case Management (FR-6.1 - FR-6.4)
router.post("/add-incident", authenticateUser, addIncident);

// Case Log & Search (FR-7.1, FR-7.3)
router.get("/get-incidents", authenticateUser, getIncidents);

// Zone Overview Dashboard & KPI Analytics (FR-4.1 - FR-4.6)
router.get("/incident-stats", authenticateUser, getIncidentDashboard);

// National Dashboard & State Tile Map (FR-3.1 - FR-3.5)
router.get("/national-dashboard", authenticateUser, getNationalDashboard);

// Standing Escalation Matrix & Reference Rules (FR-5.3)
router.get("/escalation-matrix", getEscalationMatrixReference);

// Audit Trail Logs for Central Admin (FR-1.5)
router.get("/audit-logs", authenticateUser, getAuditLogs);

// Incident Update
router.put("/update-incident/:id", authenticateUser, updateIncident);

// Role-checked Status Transition (FR-7.2)
router.put("/update-incident-status/:id", authenticateUser, updateIncidentStatus);

// Delete Incident
router.delete("/delete-incident/:id", authenticateUser, deleteIncident);

export default router;
