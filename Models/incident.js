import mongoose from "mongoose";
import { dbConnections } from "../Database/db.js";
import {
  generateCaseId,
  isNonDowngradable,
  getEscalationDetails,
  calculateSlaDeadline,
} from "../Utils/prekConstants.js";

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
    // FR-6.2: Auto-generated unique Case ID
    caseId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "incident-reporting@prek-safety.internal",
    },
    schoolName: {
      type: String,
      trim: true,
    },
    centreName: {
      type: String,
      trim: true,
    },
    state: {
      type: String,
      trim: true,
      index: true,
    },
    region: {
      type: String,
      trim: true,
      set: normalizeRegion,
    },
    zone: {
      type: String,
      trim: true,
      set: normalizeRegion,
      index: true,
    },
    category: {
      type: String,
      enum: ["Incident", "Near Miss", "Hazard & Risk"],
      default: "Incident",
      set: normalizeCategory,
    },
    incidentType: {
      type: String,
      trim: true,
      index: true,
    },
    subCategory: {
      type: String,
      trim: true,
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
      trim: true,
    },
    reporterName: {
      type: String,
      trim: true,
    },
    reporterRole: {
      type: String,
      trim: true,
    },
    stakeholders: [
      {
        type: String,
        trim: true,
      },
    ],
    briefDescription: {
      type: String,
      trim: true,
    },
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
    escalationOwner: {
      type: String,
      trim: true,
    },
    escalationOwnerRole: {
      type: String,
      trim: true,
    },
    sla: {
      type: String,
      trim: true,
    },
    slaDeadline: {
      type: Date,
    },
    slaHours: {
      type: Number,
    },
    slaAction: {
      type: String,
      trim: true,
    },
    remarks: String,
    closedBy: {
      userId: String,
      userName: String,
      userRole: String,
      closedAt: Date,
    },
    history: [
      {
        changedBy: String,
        userRole: String,
        action: String,
        previousStatus: String,
        newStatus: String,
        timestamp: { type: Date, default: Date.now },
        remarks: String,
      },
    ],

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

// Pre-save normalization and business rules hook
incidentSchema.pre("save", function (next) {
  // FR-6.2: Ensure unique Case ID
  if (!this.caseId) {
    this.caseId = generateCaseId();
  }

  // Sync incidentType and subCategory
  if (this.incidentType && !this.subCategory) {
    this.subCategory = this.incidentType;
  } else if (this.subCategory && !this.incidentType) {
    this.incidentType = this.subCategory;
  }

  // FR-5.2: Corporal Punishment and POCSO cannot be downgraded from Critical
  if (isNonDowngradable(this.incidentType) || isNonDowngradable(this.subCategory)) {
    this.severity = "Critical";
  } else if (this.severity) {
    const norm = normalizeSeverity(this.severity);
    this.severity = norm === "unknown" ? "Low" : norm;
  }

  // Normalize status
  if (this.status) {
    const norm = normalizeStatus(this.status);
    this.status = norm === "unknown" ? "Open" : norm;
  }

  // Normalize category & region
  if (this.category) this.category = normalizeCategory(this.category);
  if (this.region) this.region = normalizeRegion(this.region);
  if (this.zone) this.zone = normalizeRegion(this.zone);

  // Sync aliases
  if (this.zone && !this.region) this.region = this.zone;
  if (this.region && !this.zone) this.zone = this.region;
  if (this.centreName && !this.schoolName) this.schoolName = this.centreName;
  if (this.schoolName && !this.centreName) this.centreName = this.schoolName;
  if (this.reporterName && !this.reportedBy) this.reportedBy = this.reporterName;
  if (this.reportedBy && !this.reporterName) this.reporterName = this.reportedBy;

  // Auto-populate escalation rules and SLA from severity (FR-5.1 & FR-6.4)
  const escalation = getEscalationDetails(this.severity);
  this.escalationOwner = escalation.owner;
  this.escalationOwnerRole = escalation.ownerRole;
  this.sla = escalation.sla;
  this.slaHours = escalation.slaHours;
  this.slaAction = escalation.action;
  if (!this.slaDeadline) {
    this.slaDeadline = calculateSlaDeadline(this.date || this.createdAt, this.severity);
  }

  next();
});

// Compound Indexes based on role-based queries (ESR Rule)
incidentSchema.index({ zone: 1, date: -1 });
incidentSchema.index({ state: 1, date: -1 });
incidentSchema.index({ incidentType: 1, date: -1 });
incidentSchema.index({ severity: 1, date: -1 });
incidentSchema.index({ status: 1, date: -1 });

// School + Branch + Date / createdAt
incidentSchema.index({ schoolId: 1, branchId: 1, date: -1 });
incidentSchema.index({ schoolId: 1, branchId: 1, createdAt: -1 });

// School-wide queries + Date / createdAt
incidentSchema.index({ schoolId: 1, date: -1 });
incidentSchema.index({ schoolId: 1, createdAt: -1 });

// Branch-specific & BranchGroup queries ($in: branchIds) + Date / createdAt
incidentSchema.index({ branchId: 1, date: -1 });
incidentSchema.index({ branchId: 1, createdAt: -1 });

// Parent-specific queries + Date / createdAt
incidentSchema.index({ parentId: 1, date: -1 });
incidentSchema.index({ parentId: 1, createdAt: -1 });

// Global date / createdAt index
incidentSchema.index({ date: -1 });
incidentSchema.index({ createdAt: -1 });

// Role + Region + Category + Date / createdAt drill-down queries
incidentSchema.index({ schoolId: 1, region: 1, category: 1, date: -1 });
incidentSchema.index({ schoolId: 1, region: 1, category: 1, createdAt: -1 });

const Incident = dbConnections.db2?.model
  ? dbConnections.db2.model("Incident", incidentSchema)
  : mongoose.model("Incident", incidentSchema);

export default Incident;
