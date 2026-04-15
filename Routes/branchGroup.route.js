import express from 'express';
import { addBranchGroup, deleteBranchGroup, getBranchGroups, updateBranchGroup } from '../Controllers/BranchGroup.Controller.js';
import authenticateUser from '../Middleware/authMiddleware.js';


const router = express.Router();

router.post('/branchGroup',authenticateUser,addBranchGroup);
router.get('/branchGroup',authenticateUser,getBranchGroups);
router.put('/branchGroup/:id',authenticateUser,updateBranchGroup);
router.delete('/branchGroup/:id',authenticateUser,deleteBranchGroup);

export default router;