import express from "express";
import authenticateUser from "../Middleware/authMiddleware.js";
import { createContact, getAllContacts, updateContact, deleteContact } from "../Controllers/Support.Controller.js";

const router = express.Router()

router.post("/support/contact",authenticateUser, createContact);
router.get("/support/contact",authenticateUser, getAllContacts);
router.put("/support/contact/:id",authenticateUser, updateContact);
router.delete("/support/contact/:id",authenticateUser, deleteContact);


export default router