import express from "express";
import authenticateUser from "../Middleware/authMiddleware.js";
import {
  addDriver,
  approveDriver,
  checkDriverDeviceAssigned,
  deleteDriver,
  driverDropdown,
  getDriverByRouteObjId,
  getDrivers,
  updateDriver,
} from "../Controllers/Driver.Controller.js";

const router = express.Router();

router.post("/driver", authenticateUser, addDriver);
router.get("/driver", authenticateUser, getDrivers);
router.put("/driver/:id", authenticateUser, updateDriver);
router.post("/driver/approve/:id", authenticateUser, approveDriver);
router.delete("/driver/:id", authenticateUser, deleteDriver);

router.get("/driver/dropdown", authenticateUser, driverDropdown);




router.get("/driver/routewise/:routeObjId", authenticateUser, getDriverByRouteObjId);




router.get("/driver/already-assign-check/:routeObjId", authenticateUser, checkDriverDeviceAssigned);

export default router;
