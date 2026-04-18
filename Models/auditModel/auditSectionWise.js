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
      name: String,
      score: { type: Number, enum: [0,1,2] },
      isCritical: Boolean,
      isCompliant: Boolean,
      remark: String
    }
  ],

  sectionScore: Number,
  isCriticalFailed: Boolean,

  updatedBy: mongoose.Schema.Types.ObjectId

}, { timestamps: true });

auditSectionSchema.index({ auditId: 1, sectionName: 1 }, { unique: true });

export default dbConnections.db2.model('AuditSectionWise', auditSectionSchema);
