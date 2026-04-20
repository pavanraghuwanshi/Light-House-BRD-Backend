import mongoose from "mongoose";
import { dbConnections } from "../../Database/db.js";

const auditSectionSchema = new mongoose.Schema({
  auditId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Audit",
    required: true
  },

  sectionName: {
    type: String,
    enum: ["A","B","C","D","E","F","G","H","I"],
    required: true
  },

  parameters: [
    {
      key: { type: String, required: true }, // 🔥 IMPORTANT
      name: String, // only for UI

      score: { type: Number, enum: [0,1,2], default: 0 },

      isCritical: Boolean, // backend controlled
      isCompliant: Boolean, // optional (can remove later)

      remark: String,
      evidence: String, // optional (future use)
      
      maxScore: { type: Number, default: 2 } // 🔥 future-proof
    }
  ],

  sectionScore: {
    type: Number,
    default: 0
  },

  isCriticalFailed: {
    type: Boolean,
    default: false
  },

  updatedBy: mongoose.Schema.Types.ObjectId

}, { timestamps: true });

// ✅ Prevent duplicate section per audit
auditSectionSchema.index({ auditId: 1, sectionName: 1 }, { unique: true });

export default dbConnections.db2.model('AuditSectionWise', auditSectionSchema);