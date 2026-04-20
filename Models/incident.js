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
      enum: [
        "Fire",
        "Infrastructure",
        "Transport",
        "Behavioural",
        "Classroom",
        "Play Area",
        "Laboratory",
        "Electrical",
        "Unattended Children",
        "CCTV",
        "BGV",
        "Health & Hygiene",
        "Bullying",
        "Theft",
        "Other",
      ],
      required: true,
    },
    stakeholders: [
      {
        type: String,
        enum: [
          "Operations HO",
          "OPS-Infra",
          "Projects",
          "Principal",
          "Head School Operations",
          "RSO",
          "Child Counsellor",
          "Transport Manager",
        ],
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
      enum: ["Open", "In Progress", "Closed"],
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
