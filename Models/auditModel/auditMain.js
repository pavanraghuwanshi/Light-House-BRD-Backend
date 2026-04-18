import mongoose from "mongoose";
import { dbConnections } from "../../Database/db.js";

const auditSchema = new mongoose.Schema({
  schoolId: mongoose.Schema.Types.ObjectId,
  regionId: mongoose.Schema.Types.ObjectId,

  createdBy: mongoose.Schema.Types.ObjectId,
  assignedTo: mongoose.Schema.Types.ObjectId,

  status: {
    type: String,
    enum: ["draft", "completed"],
    default: "draft"
  },

  totalScore: Number,
  percentage: Number,
  result: {
    type: String,
    enum: ["PASS", "CONDITIONAL_PASS", "FAIL"]
  },

  criticalFailed: Boolean

}, { timestamps: true });

export default dbConnections.db2.model('Audit', auditSchema);
