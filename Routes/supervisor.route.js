import express from 'express';
import authenticateUser from '../Middleware/authMiddleware.js';
import { addSupervisor, approveSupervisor, deleteSupervisor, getSupervisors, updateSupervisor } from '../Controllers/Supervisor.Controller.js';

const router = express.Router();

router.post('/supervisor',authenticateUser,addSupervisor);
router.get('/supervisor',authenticateUser,getSupervisors);
router.put('/supervisor/:id',authenticateUser,updateSupervisor);
router.post('/supervisor/approve/:id',authenticateUser,approveSupervisor);
router.delete('/supervisor/:id',authenticateUser,deleteSupervisor);

export default router;