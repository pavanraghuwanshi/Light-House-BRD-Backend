import mongoose from "mongoose";
import { dbConnections } from "../Database/db.js";



const incidentSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
    },
    schoolName: {
      type: String,
    },
    region: {
      type: String,
    },
    category: {
      type: String,
      enum: ["Incident", "Near Miss", "Hazard & Risk"],
      required: true,
    },
    reportedBy: {
      type: String,
      required: true,
    },
    subCategory: {
      type: String,
      required: true,
    },
    stakeholders: [
      {
        type: String,
      },
    ],
    briefDescription: String,
    immediateActionTaken: String,
    pendingAction: String,
    closureDate: Date,
    date: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["Open", "In Progress", "In-Progress", "Resolved", "Closed", "Close"],
      default: "Open",
    },
    escalationStatus: {
      type: String,
      enum: ["No", "Yes"],
      default: "No",
    },
    escalatedTo: String,
    remarks: String,

    // optional references
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Parent",
    },
  },
  { timestamps: true }
);
export default dbConnections.db2.model("Incident", incidentSchema);
