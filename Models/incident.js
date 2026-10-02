import mongoose from "mongoose";
import { dbConnections } from "../Database/db.js";



// Normalization utilities
export const normalizeStatus = (status) => {
  if (!status || typeof status !== "string") return "unknown";
  const s = status.trim().toLowerCase();
  if (s === "open") return "Open";
  if (s === "in progress" || s === "in-progress" || s === "inprogress") return "In Progress";
  if (s === "resolved") return "Resolved";
  if (s === "closed" || s === "close") return "Closed";
  return "unknown";
};

export const normalizeSeverity = (severity) => {
  if (!severity || typeof severity !== "string") return "unknown";
  const s = severity.trim().toLowerCase();
  if (s === "low") return "Low";
  if (s === "medium") return "Medium";
  if (s === "high") return "High";
  if (s === "critical") return "Critical";
  return "unknown";
};

export const normalizeCategory = (category) => {
  if (!category) return category;
  const c = String(category).trim().toLowerCase();
  if (c === "incident") return "Incident";
  if (c === "near miss" || c === "near-miss" || c === "nearmiss") return "Near Miss";
  if (c === "hazard & risk" || c === "hazard and risk" || c === "hazard") return "Hazard & Risk";
  return category.trim();
};

export const normalizeRegion = (region) => {
  if (!region) return region;
  return String(region).trim();
};

const incidentSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    schoolName: {
      type: String,
      trim: true,
    },
    region: {
      type: String,
      trim: true,
      set: normalizeRegion,
    },
    category: {
      type: String,
      enum: ["Incident", "Near Miss", "Hazard & Risk"],
      required: true,
      set: normalizeCategory,
    },
    severity: {
      type: String,
      enum: ["Low", "Medium", "High", "Critical", "low", "medium", "high", "critical", "unknown"],
      default: "Low",
      set: (val) => {
        const norm = normalizeSeverity(val);
        return norm === "unknown" ? "Low" : norm;
      },
    },
    reportedBy: {
      type: String,
      required: true,
      trim: true,
    },
    subCategory: {
      type: String,
      required: true,
      trim: true,
    },
    stakeholders: [
      {
        type: String,
        trim: true,
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
      enum: ["Open", "In Progress", "In-Progress", "Resolved", "Closed", "Close", "unknown"],
      default: "Open",
      set: (val) => {
        const norm = normalizeStatus(val);
        return norm === "unknown" ? "Open" : norm;
      },
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

// Pre-save normalization hook
incidentSchema.pre("save", function (next) {
  if (this.status) {
    const norm = normalizeStatus(this.status);
    this.status = norm === "unknown" ? "Open" : norm;
  }
  if (this.severity) {
    const norm = normalizeSeverity(this.severity);
    this.severity = norm === "unknown" ? "Low" : norm;
  }
  if (this.category) this.category = normalizeCategory(this.category);
  if (this.region) this.region = normalizeRegion(this.region);
  next();
});

// ✅ Compound Indexes based on actual role-based queries (ESR Rule)
// 1. School + Branch + Date / createdAt
incidentSchema.index({ schoolId: 1, branchId: 1, date: -1 });
incidentSchema.index({ schoolId: 1, branchId: 1, createdAt: -1 });

// 2. School-wide queries + Date / createdAt
incidentSchema.index({ schoolId: 1, date: -1 });
incidentSchema.index({ schoolId: 1, createdAt: -1 });

// 3. Branch-specific & BranchGroup queries ($in: branchIds) + Date / createdAt
incidentSchema.index({ branchId: 1, date: -1 });
incidentSchema.index({ branchId: 1, createdAt: -1 });

// 4. Parent-specific queries + Date / createdAt
incidentSchema.index({ parentId: 1, date: -1 });
incidentSchema.index({ parentId: 1, createdAt: -1 });

// 5. Global date / createdAt index for superAdmin queries without school filter
incidentSchema.index({ date: -1 });
incidentSchema.index({ createdAt: -1 });

// 6. Role + Region + Category + Date / createdAt drill-down queries
incidentSchema.index({ schoolId: 1, region: 1, category: 1, date: -1 });
incidentSchema.index({ schoolId: 1, region: 1, category: 1, createdAt: -1 });

export default dbConnections.db2.model("Incident", incidentSchema);

