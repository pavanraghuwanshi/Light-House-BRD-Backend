import mongoose from "mongoose";
import { dbConnections } from "../Database/db.js";
import { PREK_ROLES, normalizePrekRole } from "../Utils/prekConstants.js";

/**
 * Pre-K Portal User Schema (BRD v1.1 Section 5 & Section 6.1)
 * Enforces role-based access control for 5 roles:
 * - Area Operations Manager (AOM) (~60 users)
 * - Business Manager (BM) (~25 users)
 * - Regional Safety Officer (RSO) (~4 users)
 * - National Head (~3 users)
 * - Central (All-Activity Admin) (~2 users)
 */
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      required: true,
      enum: [
        PREK_ROLES.AOM,
        PREK_ROLES.BM,
        PREK_ROLES.RSO,
        PREK_ROLES.NATIONAL_HEAD,
        PREK_ROLES.CENTRAL,
      ],
      set: (val) => normalizePrekRole(val) || val,
      index: true,
    },
    zone: {
      type: String,
      trim: true,
      index: true, // "North", "South", "East", "West", "Central"
    },
    cluster: {
      type: String,
      trim: true, // Business Manager cluster
      index: true,
    },
    centres: [
      {
        type: String,
        trim: true,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    // FR-1.6: Account Lockout Fields
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    lockUntil: {
      type: Date,
      default: null,
    },
    lastLoginAt: {
      type: Date,
    },
    // Refresh Token Management (30 days validity)
    refreshToken: {
      type: String,
      default: null,
    },
    refreshTokenExpiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

userSchema.index({ role: 1, zone: 1 });
userSchema.index({ role: 1, cluster: 1 });

const User = mongoose.models.User || mongoose.model("User", userSchema);

export default User;

