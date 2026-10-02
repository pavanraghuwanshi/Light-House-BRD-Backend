/**
 * Incident Collection Normalization Migration Script (Option 1: Backfill & Cleanse)
 *
 * This script standardizes historical incident records in MongoDB:
 * - Missing or invalid severity -> backfilled to "Low" (default schema severity)
 * - Missing or invalid status   -> backfilled to "Open" (default schema status)
 * - Known casing/variations     -> standardized to canonical title-case
 * - Category & Region           -> normalized and trimmed
 *
 * Usage:
 *   Dry-run mode (default, no writes):
 *     node scripts/normalize-incidents.js --dry-run
 *
 *   Live apply mode (performs batched atomic updates):
 *     node scripts/normalize-incidents.js --apply
 */

import dotenv from "dotenv";
import Incident, {
  normalizeStatus,
  normalizeSeverity,
  normalizeCategory,
  normalizeRegion,
} from "../Models/incident.js";

dotenv.config();

const isDryRun = !process.argv.includes("--apply");
const BATCH_SIZE = 500;

async function runMigration() {
  console.log("==================================================");
  console.log(`INCIDENT NORMALIZATION MIGRATION (${isDryRun ? "DRY RUN - READ ONLY" : "LIVE APPLY MODE"})`);
  console.log("==================================================");

  try {
    console.log("Connecting to Incident database (db2)...");
    await Incident.db.asPromise();
    console.log("Connected to Incident database successfully.\n");

    const cursor = Incident.find({}, { status: 1, severity: 1, category: 1, region: 1, subCategory: 1 }).cursor();

    let scannedCount = 0;
    let needsUpdateCount = 0;
    let statusFixCount = 0;
    let severityFixCount = 0;
    let categoryFixCount = 0;
    let regionFixCount = 0;

    let bulkOps = [];

    for await (const doc of cursor) {
      scannedCount++;

      const currentStatus = doc.status;
      const currentSeverity = doc.severity;
      const currentCategory = doc.category;
      const currentRegion = doc.region;

      // Normalize or backfill missing/unknown to defaults
      let expectedStatus = normalizeStatus(currentStatus);
      if (expectedStatus === "unknown" || !expectedStatus) {
        expectedStatus = "Open";
      }

      let expectedSeverity = normalizeSeverity(currentSeverity);
      if (expectedSeverity === "unknown" || !expectedSeverity) {
        expectedSeverity = "Low";
      }

      const expectedCategory = normalizeCategory(currentCategory);
      const expectedRegion = normalizeRegion(currentRegion);

      const updates = {};
      if (currentStatus !== expectedStatus) {
        updates.status = expectedStatus;
        statusFixCount++;
      }
      if (currentSeverity !== expectedSeverity) {
        updates.severity = expectedSeverity;
        severityFixCount++;
      }
      if (expectedCategory && currentCategory !== expectedCategory) {
        updates.category = expectedCategory;
        categoryFixCount++;
      }
      if (expectedRegion && currentRegion !== expectedRegion) {
        updates.region = expectedRegion;
        regionFixCount++;
      }

      if (Object.keys(updates).length > 0) {
        needsUpdateCount++;
        bulkOps.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: updates },
          },
        });

        if (!isDryRun && bulkOps.length >= BATCH_SIZE) {
          await Incident.bulkWrite(bulkOps);
          bulkOps = [];
          console.log(`Updated batch up to ${scannedCount} scanned documents...`);
        }
      }
    }

    if (!isDryRun && bulkOps.length > 0) {
      await Incident.bulkWrite(bulkOps);
      console.log(`Updated final batch.`);
    }

    console.log("\n--------------------------------------------------");
    console.log("MIGRATION SUMMARY:");
    console.log(`Total Documents Scanned:      ${scannedCount}`);
    console.log(`Documents Requiring Update:   ${needsUpdateCount}`);
    console.log(`  - Severity backfills/fixes: ${severityFixCount}`);
    console.log(`  - Status backfills/fixes:   ${statusFixCount}`);
    console.log(`  - Category adjustments:     ${categoryFixCount}`);
    console.log(`  - Region adjustments:       ${regionFixCount}`);
    console.log("--------------------------------------------------");

    if (isDryRun) {
      console.log("\n[DRY RUN COMPLETE] No records were modified in the database.");
      console.log("To apply these updates to MongoDB, run: node scripts/normalize-incidents.js --apply");
    } else {
      console.log("\n[APPLY COMPLETE] All unnormalized and missing fields have been successfully updated.");
    }

  } catch (error) {
    console.error("Migration error:", error);
    process.exitCode = 1;
  } finally {
    await Incident.db.close();
    console.log("Database connection closed.");
    process.exit(0);
  }
}

if (process.argv[1]?.endsWith("normalize-incidents.js")) {
  runMigration();
}
