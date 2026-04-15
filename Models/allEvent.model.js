import mongoose from "mongoose";
import { dbConnections } from "../Database/db.js";

const allEventsSchema = new mongoose.Schema(
  {
    uniqueId: {
      type: Number,
      required: true,
      index: true,
    },

    eventType: {
      type: String,
      required: true,
      enum: [
        "OVERSPEED",
        "ignition On",
        "ignition Off",
        "SOS",
        "PARKING_VIOLATION"
      ],
    },

    speed: {
      type: Number,
      default: null,
    },

    speedLimit: {
      type: Number,
      default: null,
    },

    ignition: {
      type: Boolean,
      default: null,
    },

    sos: {
      type: Boolean,
      default: null,
    },
    latitude: {
      type: Number,
      default: null,
    },
    longitude: {
      type: Number,
      default: null,
    },
    eventTime:{ type: Date, default: () => new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000))},
    createdAt: { type: Date, default: () => new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000)) }


  }
);

export const AllEvents = dbConnections.db2.model("AllEvents", allEventsSchema);