import express from 'express';
const router = express.Router();

import { addIncident, getIncidents, updateIncident, deleteIncident} from '../Controllers/Incident.Controller.js';

import authenticateUser from '../Middleware/authMiddleware.js';

// ✅ Create
router.post("/add-incident", authenticateUser, addIncident);

// ✅ Get
router.get("/get-incidents", authenticateUser, getIncidents);

// ✅ Dashboard
// router.get("/incident-dashboard", authenticateUser, getIncidentDashboard);

// ✅ Update
router.put("/update-incident/:id", authenticateUser, updateIncident);

// ✅ Delete
router.delete("/delete-incident/:id", authenticateUser, deleteIncident);

export default router;