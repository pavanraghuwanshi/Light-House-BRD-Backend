import { AUDIT_CRITICAL_CONFIG } from "../../config/auditCriticalConfig.js";
import Audit from "../../Models/auditModel/auditMain.js";
import AuditSection from "../../Models/auditModel/auditSectionWise.js";
import { resolveSchoolAndBranch } from "../../Utils/roleResolver.js";


// SAVE SECTION (ALL 11 FORMS)

export const saveSection = async (req, res) => {
  try {
    const { role, id } = req.user;
    const { auditId, sectionName, parameters } = req.body;

    // ✅ Resolve hierarchy
    const { schoolId } = resolveSchoolAndBranch(req);

    const audit = await Audit.findById(auditId);

    if (!audit) {
      return res.status(404).json({ message: "Audit not found" });
    }

    // 🔐 Ensure same school access
    if (audit.schoolId.toString() !== schoolId.toString()) {
      return res.status(403).json({ message: "Unauthorized access" });
    }

    // 🔐 Role check
    if (!["superAdmin", "school", "branchGroup", "branch"].includes(role)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    let sectionScore = 0;
    let isCriticalFailed = false;

    const criticalList = AUDIT_CRITICAL_CONFIG[sectionName] || [];

    const processedParams = parameters.map(p => {
      sectionScore += p.score;

      // ✅ Decide critical from backend config
      const isCritical = criticalList.includes(p.name);

      if (isCritical && p.isCompliant === false) {
        isCriticalFailed = true;
      }

      return {
        ...p,
        isCritical // 🔥 override frontend value
      };
    });

    const section = await AuditSection.findOneAndUpdate(
      { auditId, sectionName },
      {
        parameters: processedParams,
        sectionScore,
        isCriticalFailed,
        updatedBy: id
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      data: section
    });

  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};