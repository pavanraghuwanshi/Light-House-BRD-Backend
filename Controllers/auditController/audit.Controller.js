import { AUDIT_CRITICAL_CONFIG } from "../../config/auditCriticalConfig.js";
import { SECTION_WEIGHTS } from "../../config/auditWeightConfig.js";
import Audit from "../../Models/auditModel/auditMain.js";
import AuditSection from "../../Models/auditModel/auditSectionWise.js";
import School from "../../Models/school.js";
import { buildQueryWithRole, resolveSchoolAndBranch } from "../../Utils/roleResolver.js";
import mongoose from "mongoose";




// CREATE AUDIT (WITH HIERARCHY)
export const createAudit = async (req, res) => {
  try {
    // ✅ Same logic as Incident
    const { schoolId, branchId, parentId } = resolveSchoolAndBranch(req);

    // ✅ Validate School
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: "School not found" });
    }

    const { regionId, assignedTo } = req.body;

    const audit = await Audit.create({
      schoolId,
      branchId,
      parentId,
      regionId,
      assignedTo,
      createdBy: req.user.id,
      status: "draft"
    });

    return res.status(201).json({
      success: true,
      message: "Audit created successfully",
      data: audit
    });

  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
};



//  GET ALL AUDITS (ROLE + HIERARCHY)

export const getAudits = async (req, res) => {
  try {
    let { page = 1, limit = 10, search = "" } = req.query;

    page = Math.max(1, parseInt(page));
    limit = Math.max(1, parseInt(limit));
    const skip = (page - 1) * limit;

    // ✅ Role-based filter
    let filter = buildQueryWithRole(req);

    // ✅ Convert ObjectIds (important for index usage)
    if (filter?.branchId) {
      filter.branchId = new mongoose.Types.ObjectId(filter.branchId);
    }
    if (filter?.schoolId) {
      filter.schoolId = new mongoose.Types.ObjectId(filter.schoolId);
    }
    // if (filter?.parentId) {
    //   filter.parentId = new mongoose.Types.ObjectId(filter.parentId);
    // }

    // 🔥 Base pipeline (FAST MATCH FIRST)
    const pipeline = [
      { $match: filter },

      ...(search
        ? [
            {
              $lookup: {
                from: "schools",
                localField: "schoolId",
                foreignField: "_id",
                as: "school",
              },
            },
            {
              $lookup: {
                from: "branches",
                localField: "branchId",
                foreignField: "_id",
                as: "branch",
              },
            },
            {
              $match: {
                $or: [
                  { "school.schoolName": { $regex: search, $options: "i" } },
                  { "branch.branchName": { $regex: search, $options: "i" } },
                ],
              },
            },
          ]
        : []),

      { $sort: { createdAt: -1 } },

      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },

            // ✅ ✅ CORRECT COLLECTION NAME
            {
              $lookup: {
                from: "auditsectionwises",
                let: { auditId: "$_id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: ["$auditId", "$$auditId"]
                      }
                    }
                  }
                ],
                as: "sections",
              },
            },


            // ✅ createdBy → schools
            {
              $lookup: {
                from: "schools",
                localField: "createdBy",
                foreignField: "_id",
                pipeline: [{ $project: { schoolName: 1 } }],
                as: "createdBySchool",
              },
            },

            // ✅ createdBy → branches
            {
              $lookup: {
                from: "branches",
                localField: "createdBy",
                foreignField: "_id",
                pipeline: [{ $project: { branchName: 1 } }],
                as: "createdByBranch",
              },
            },

            // ✅ createdBy → branchgroups (optional but recommended)
            {
              $lookup: {
                from: "branchgroups",
                localField: "createdBy",
                foreignField: "_id",
                pipeline: [{ $project: { branchGroupName: 1,regionHeadName:1 } }],
                as: "createdByBranchGroup",
              },
            },

            // 🔥 FINAL NAME RESOLVE
            {
              $addFields: {
                createdByName: {
                  $ifNull: [
                    { $arrayElemAt: ["$createdByUser.name", 0] },
                    {
                      $ifNull: [
                        { $arrayElemAt: ["$createdBySchool.schoolName", 0] },
                        {
                          $ifNull: [
                            { $arrayElemAt: ["$createdByBranch.branchName", 0] },
                            { $arrayElemAt: ["$createdByBranchGroup.branchGroupName", 0] }
                          ]
                        }
                      ]
                    }
                  ]
                },

                // ✅ IMPORTANT: ye bhi andar hi rahega
                regionHeadName: {
                  $arrayElemAt: ["$createdByBranchGroup.regionHeadName", 0]
                }
              }
            },

            // ❌ cleanup
            {
              $project: {
                createdByUser: 0,
                createdBySchool: 0,
                createdByBranch: 0,
                createdByBranchGroup: 0,
              }
            },

            // ✅ School (only name)
            {
              $lookup: {
                from: "schools",
                localField: "schoolId",
                foreignField: "_id",
                pipeline: [{ $project: { schoolName: 1 } }],
                as: "school",
              },
            },
            {
              $addFields: {
                schoolName: { $arrayElemAt: ["$school.schoolName", 0] }
              },
            },

            // ✅ Branch (only name)
            {
              $lookup: {
                from: "branches",
                localField: "branchId",
                foreignField: "_id",
                pipeline: [{ $project: { branchName: 1 } }],
                as: "branch",
              },
            },
            {
              $addFields: {
                branchName: { $arrayElemAt: ["$branch.branchName", 0] }
              },
            },

            {
              $project: {
                school: 0,
                branch: 0,
              },
            },
          ],

          total: [{ $count: "count" }],
        },
      },
    ];

    const result = await Audit.aggregate(pipeline);

    return res.status(200).json({
      success: true,
      total: result[0]?.total[0]?.count || 0,
      page,
      limit,
      data: result[0]?.data || [],
    });

  } catch (err) {
    console.error("GET AUDITS ERROR:", err);
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
};



//  all section total persentage 

export const finalizeAudit = async (req, res) => {
  try {
    const { auditId } = req.params;

    const audit = await Audit.findById(auditId);
    if (!audit) {
      return res.status(404).json({ message: "Audit not found" });
    }

    // ❌ Already finalized
    if (audit.status === "completed") {
      return res.status(400).json({ message: "Already finalized" });
    }

    // ✅ Get all sections
    const sections = await AuditSection.find({ auditId });

    let totalWeightedScore = 0;
    let totalWeight = 0;

    let isAuditFailed = false;
    let failureReasons = [];

    let sectionWise = [];

    for (let section of sections) {
      const sectionName = section.sectionName;
      const weight = SECTION_WEIGHTS[sectionName] || 0;

      const criticalList = AUDIT_CRITICAL_CONFIG[sectionName] || [];

      let sectionMaxScore = section.parameters.length * 2;
      let sectionObtained = 0;

      section.parameters.forEach(p => {
        sectionObtained += p.score;

        // 🔥 CRITICAL FAIL CHECK
        if (
          criticalList.includes(p.name) &&
          p.isCompliant === false
        ) {
          isAuditFailed = true;
          failureReasons.push(`${sectionName} - ${p.name}`);
        }
      });

      const sectionPercentage =
        sectionMaxScore === 0
          ? 0
          : (sectionObtained / sectionMaxScore) * 100;

      const weightedScore = (sectionPercentage * weight) / 100;

      totalWeightedScore += weightedScore;
      totalWeight += weight;

      sectionWise.push({
        section: sectionName,
        weight,
        obtained: sectionObtained,
        max: sectionMaxScore,
        percentage: sectionPercentage.toFixed(2)
      });
    }

    const finalPercentage =
      totalWeight === 0
        ? 0
        : (totalWeightedScore / totalWeight) * 100;

    // 🔥 FINAL RESULT LOGIC
    let result = "PASS";

    if (isAuditFailed) {
      result = "FAIL";
    } else if (finalPercentage < 85) {
      result = "CONDITIONAL_PASS";
    }

    // ✅ Save in DB
    audit.status = "completed";
    audit.finalScore = finalPercentage.toFixed(2);
    audit.result = result;
    audit.failureReasons = failureReasons;

    await audit.save();

    return res.json({
      success: true,
      result,
      finalPercentage: finalPercentage.toFixed(2),
      failureReasons,
      sectionWise
    });

  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
};
















//  FINALIZE AUDIT (CRITICAL + SCORE)
// export const finalizeAudit = async (req, res) => {
//   try {
//     const { role } = req.user;
//     const { auditId } = req.params;

//     if (!["admin", "safety_head"].includes(role)) {
//       return res.status(403).json({ message: "Not allowed" });
//     }

//     const { schoolId } = resolveSchoolAndBranch(req);

//     const audit = await Audit.findById(auditId);

//     if (!audit) {
//       return res.status(404).json({ message: "Audit not found" });
//     }

//     if (audit.schoolId.toString() !== schoolId.toString()) {
//       return res.status(403).json({ message: "Unauthorized" });
//     }

//     const sections = await AuditSection.find({ auditId });

//     const REQUIRED = ["A","B","C","D","E","F","G","H","I"];

//     if (sections.length < REQUIRED.length) {
//       return res.status(400).json({
//         message: "All sections not completed"
//       });
//     }

//     let total = 0;
//     let max = 0;
//     let criticalFailed = false;

//     sections.forEach(sec => {
//       total += sec.sectionScore;
//       max += sec.parameters.length * 2;

//       if (sec.isCriticalFailed) {
//         criticalFailed = true;
//       }
//     });

//     const percentage = (total / max) * 100;

//     let result;

//     if (criticalFailed) {
//       result = "FAIL";
//     } else if (percentage >= 85) {
//       result = "PASS";
//     } else {
//       result = "CONDITIONAL_PASS";
//     }

//     const updated = await Audit.findByIdAndUpdate(
//       auditId,
//       {
//         totalScore: total,
//         percentage,
//         result,
//         criticalFailed,
//         status: "completed"
//       },
//       { new: true }
//     );

//     res.json({
//       success: true,
//       data: updated
//     });

//   } catch (err) {
//     res.status(400).json({ success: false, message: err.message });
//   }
// };






// GET FULL AUDIT (WITH SECTIONS)

export const getFullAudit = async (req, res) => {
  try {
    const { auditId } = req.params;

    const { schoolId } = resolveSchoolAndBranch(req);

    const audit = await Audit.findById(auditId);

    if (!audit) {
      return res.status(404).json({ message: "Not found" });
    }

    if (audit.schoolId.toString() !== schoolId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const sections = await AuditSection.find({ auditId });

    res.json({
      success: true,
      data: { audit, sections }
    });

  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};



// Delete Audit Controller

export const deleteAudit = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Only admin allowed" });
    }

    await Audit.findByIdAndDelete(req.params.auditId);

    res.json({
      success: true,
      message: "Deleted successfully"
    });

  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};