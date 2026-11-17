import mongoose from "mongoose";

/**
 * Pre-K Zone Master Schema
 * Represents administrative zones (North, South, East, West, Central, or custom regional zones).
 * Each zone groups states and centres, supervised by a Regional Safety Officer (RSO).
 */
const zoneSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
    },
    states: [
      {
        type: String,
        trim: true,
      },
    ],
    cities: [
      {
        type: String,
        trim: true,
      },
    ],
    // Optional direct reference to assigned RSO user
    regionalSafetyOfficer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

zoneSchema.index({ name: 1, isActive: 1 });

const Zone = mongoose.models.Zone || mongoose.model("Zone", zoneSchema);

export default Zone;
