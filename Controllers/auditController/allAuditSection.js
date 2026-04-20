import { AUDIT_CRITICAL_CONFIG } from "../../config/auditCriticalConfig.js";
import Audit from "../../Models/auditModel/auditMain.js";
import AuditSection from "../../Models/auditModel/auditSectionWise.js";
import { resolveSchoolAndBranch } from "../../Utils/roleResolver.js";


// SAVE SECTION (ALL 11 FORMS)

// export const saveSection = async (req, res) => {
//   try {
//     const { role, id } = req.user;
//     const { auditId, sectionName, parameters } = req.body;

//     // ✅ Resolve hierarchy
//     const { schoolId } = resolveSchoolAndBranch(req);

//     const audit = await Audit.findById(auditId);

//     if (!audit) {
//       return res.status(404).json({ message: "Audit not found" });
//     }

//     // 🔐 Ensure same school access
//     if (audit.schoolId.toString() !== schoolId.toString()) {
//       return res.status(403).json({ message: "Unauthorized access" });
//     }

//     // 🔐 Role check
//     if (!["superAdmin", "school", "branchGroup", "branch"].includes(role)) {
//       return res.status(403).json({ message: "Not allowed" });
//     }

//     let sectionScore = 0;
//     let isCriticalFailed = false;

//     const criticalList = AUDIT_CRITICAL_CONFIG[sectionName] || [];

//     const processedParams = parameters.map(p => {
//       sectionScore += p.score;

//       // ✅ Decide critical from backend config
//       const isCritical = criticalList.includes(p.name);

//       if (isCritical && p.isCompliant === false) {
//         isCriticalFailed = true;
//       }

//       return {
//         ...p,
//         isCritical // 🔥 override frontend value
//       };
//     });

//     const section = await AuditSection.findOneAndUpdate(
//       { auditId, sectionName },
//       {
//         parameters: processedParams,
//         sectionScore,
//         isCriticalFailed,
//         updatedBy: id
//       },
//       { upsert: true, new: true }
//     );

//     res.json({
//       success: true,
//       data: section
//     });

//   } catch (err) {
//     res.status(400).json({ success: false, message: err.message });
//   }
// };



const SECTION_NAME_MAP = {
  "Governance & Safety Management": "A",
  "Fire Safety": "B",
  "Building & Infrastructure Safety": "C",
  "Electrical / Lab / Chemical Safety": "D",
  "Child Safety & Protection": "E",
  "Security & Access Control": "F",
  "Health, Hygiene & Environment": "G",
  "Transport Safety": "H",
  "Food Safety": "I"
};



export const saveSection = async (req, res) => {
  try {
    const { role, id } = req.user;
    const { auditId, sectionName, parameters } = req.body;

    if (!auditId || !sectionName || !Array.isArray(parameters)) {
      return res.status(400).json({ message: "Invalid payload" });
    }

    // 🔥 Convert sectionName → sectionCode
    const sectionCode =
      AUDIT_CRITICAL_CONFIG[sectionName] 
        ? sectionName // already A/B/C
        : SECTION_NAME_MAP[sectionName];

    if (!sectionCode) {
      return res.status(400).json({ message: "Invalid section name" });
    }

    const { schoolId } = resolveSchoolAndBranch(req);

    const audit = await Audit.findById(auditId);
    if (!audit) {
      return res.status(404).json({ message: "Audit not found" });
    }

    if (audit.schoolId.toString() !== schoolId.toString()) {
      return res.status(403).json({ message: "Unauthorized access" });
    }

    if (!["superAdmin", "school", "branchGroup", "branch"].includes(role)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    // ✅ Correct critical list
    const criticalList = AUDIT_CRITICAL_CONFIG[sectionCode] || [];

    let sectionScore = 0;
    let isCriticalFailed = false;

    const processedParams = parameters.map((p) => {
      if (!p.key) {
        throw new Error(`Missing key for parameter: ${p.name}`);
      }

      const isCritical = criticalList.includes(p.key);

      const score = typeof p.score === "number" ? p.score : 0;
      sectionScore += score;

      // 🔥 Strict backend logic
      if (isCritical && score !== 2) {
        isCriticalFailed = true;
      }

      return {
        key: p.key,
        name: p.name,
        score,
        remark: p.remark || "",
        evidence: p.evidence || null,
        isCritical
      };
    });

    const section = await AuditSection.findOneAndUpdate(
      { auditId, sectionName: sectionCode }, // 🔥 store code
      {
        parameters: processedParams,
        sectionScore,
        isCriticalFailed,
        updatedBy: id
      },
      { upsert: true, new: true }
    );

    return res.json({
      success: true,
      data: section
    });

  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
};