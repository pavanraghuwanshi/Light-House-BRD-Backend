import mongoose from "mongoose";
import { dbConnections } from "../../Database/db.js";

const auditSchema = new mongoose.Schema({
  schoolId: mongoose.Schema.Types.ObjectId,
  branchId: mongoose.Schema.Types.ObjectId,
  regionId: mongoose.Schema.Types.ObjectId,

  createdBy: mongoose.Schema.Types.ObjectId,
  assignedTo: mongoose.Schema.Types.ObjectId,

  status: {
    type: String,
    enum: ["draft", "completed", "failed"], // ✅ added failed
    default: "draft"
  },

  result: {
    type: String,
    enum: ["PASS", "CONDITIONAL PASS", "FAIL"]
  },

  finalScore: { // ✅ consistent naming
    type: Number
  },

  // 🔥 Detailed failure tracking
  criticalIssues: [
    {
      section: String,
      issues: [
        {
          parameter: String,
          expected: Number,
          actual: Number
        }
      ]
    }
  ],

  // 📊 Section-wise breakdown
  sectionWiseScore: [
    {
      section: String,
      obtained: Number,
      max: Number,
      percentage: String
    }
  ],

  completedAt: Date,

}, { timestamps: true });

export default dbConnections.db2.model('Audit', auditSchema);