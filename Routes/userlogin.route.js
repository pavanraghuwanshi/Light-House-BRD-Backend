import express from 'express';
import { addAdmin, loginUser, NotificationOnOff, storeFcmToken, toggleAccountActivation } from '../Controllers/User.Controller.js';
import authenticateUser from '../Middleware/authMiddleware.js';

const router = express.Router();


router.post("/login",loginUser);
router.post("/superadmin",addAdmin);
router.post("/fcmtoken/store",authenticateUser,storeFcmToken);
router.post("/notification/on-off",authenticateUser,NotificationOnOff);

router.put("/user/deactivate/:id", authenticateUser, toggleAccountActivation);


export default router;