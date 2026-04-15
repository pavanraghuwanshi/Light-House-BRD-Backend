import School from "../Models/school.js";
import Branch from "../Models/branch.js";
import BranchGroup from "../Models/branchGroup.js";
import Parent from "../Models/parents.js";
import findSameUsername from "../Utils/findSameUsername.js";
import { decrypt, encrypt, comparePassword } from "../Utils/crypto.js";
import SuperAdmin from "../Models/superAdmin.js";
import xlsx from "xlsx";

export const addSchool = async (req, res) => {
  const role = req.user.role;
  const {
    schoolName,
    username,
    password,
    email,
    mobileNo,
    branchName,
    fullAccess,
  } = req.body;

  if (role !== "superAdmin")
    return res
      .status(403)
      .json({ message: "You are not authorized to add a school" });
  if (!schoolName || !username || !password) {
    return res
      .status(400)
      .json({ message: "Please enter all required fields" });
  }

  try {
    const existingUserByUsername = await findSameUsername(username);
    if (existingUserByUsername.exists) {
      return res.status(400).json({ message: "Username already exists" });
    }

    const encryptedPassword = encrypt(password);

    const newSchool = new School({
      schoolName,
      username,
      password: encryptedPassword,
      email,
      mobileNo,
      branchName,
      fullAccess,
    });

    const school = await newSchool.save();

    const schoolObj = school.toObject();
    schoolObj.password = decrypt(encryptedPassword);

    res.status(201).json({
      school: schoolObj,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getSchools = async (req, res) => {
  const role = req.user.role;
  if (role !== "superAdmin")
    return res
      .status(403)
      .json({ message: "You are not authorized to view schools" });
  try {
    const schools = await School.find().select("-__v -fcmToken -updatedAt");

    schools?.forEach((school) => {
      const decryptedPassword = decrypt(school.password);
      school.password = decryptedPassword;
    });

    res.status(200).json(schools);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getSchoolsDropdown = async (req, res) => {
  try {
    const role = req.user.role;
    if (role !== "superAdmin") {
      return res.status(403).json({
        message: "Unauthorized access",
      });
    }

    const schools = await School.find()
      .select("_id schoolName")
      .sort({ schoolName: 1 });

    return res.status(200).json({
      data: schools,
    });
  } catch (err) {
    console.error("Dropdown API Error (Schools):", err);
    res.status(500).json({
      message: "Failed to load schools",
    });
  }
};

export const updateSchool = async (req, res) => {
  const role = req.user.role;
  if (role !== "superAdmin")
    return res
      .status(403)
      .json({ message: "You are not authorized to update a school" });
  const { id } = req.params;
  const { schoolName, username, password, email, mobileNo, fullAccess } =
    req.body;

  try {
    const school = await School.findById(id);

    if (username && school.username !== username) {
      if (username) {
        const existingUserByUsername = await findSameUsername(username);
        if (existingUserByUsername.exists) {
          return res.status(400).json({ message: "Username already exists" });
        }
      }
    }

    const updateData = {
      schoolName,
      username,
      email,
      mobileNo,
      ...(password ? { password: encrypt(password) } : {}),
      fullAccess,
    };

    const updatedSchool = await School.findByIdAndUpdate(id, updateData, {
      new: true,
    });

    if (!updatedSchool) {
      return res.status(404).json({ message: "School not found" });
    }

    res.status(200).json(updatedSchool);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

//  verify SuperAdmin Password For Delete School

export const verifySuperAdminPasswordForDeleteSchool = async (req, res) => {
  const { password } = req.body;
  const { id, role } = req.user;

  if (role !== "superAdmin") {
    return res.status(403).json({ message: "Unauthorized" });
  }

  if (!password) {
    return res.status(400).json({ message: "Password required" });
  }

  try {
    const admin = await SuperAdmin.findById(id);
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    const isMatch = await comparePassword(password, admin.password);
    if (!isMatch)
      return res.status(401).json({ message: "Incorrect password" });

    // Optionally: Store permission flag in Redis or memory (for short time)
    // For now, send back a signed token or flag
    res.status(200).json({ verified: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteSchool = async (req, res) => {
  const role = req.user.role;
  if (role !== "superAdmin")
    return res
      .status(403)
      .json({ message: "You are not authorized to delete a school" });
  const { id } = req.params;

  try {
    await Branch.deleteMany({ schoolId: id });
    await BranchGroup.deleteMany({ schoolId: id });
    await Parent.deleteMany({ schoolId: id });
    const deletedSchool = await School.findByIdAndDelete(id);

    if (!deletedSchool) {
      return res.status(404).json({ message: "School not found" });
    }

    res.status(200).json({ message: "School deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const grantSchoolAccess = async (req, res) => {
  const role = req.user.role;
  if (role !== "superAdmin") {
    return res
      .status(403)
      .json({ message: "You are not authorized to change access" });
  }

  const { id } = req.params;
  const { fullAccess } = req.body; // Accept fullAccess from the client

  try {
    const school = await School.findById(id);
    if (!school) {
      return res.status(404).json({ message: "School not found" });
    }

    // Only allow boolean values to be set
    if (typeof fullAccess !== "boolean") {
      return res.status(400).json({
        message: "Invalid value for fullAccess. Must be true or false.",
      });
    }

    school.fullAccess = fullAccess;
    await school.save();

    res.status(200).json({
      message: `Access ${fullAccess ? "granted" : "revoked"} successfully`,
      school,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const addMultipleSchools = async (req, res) => {
  const role = req.user.role;
  if (role !== "superAdmin") {
    return res
      .status(403)
      .json({ message: "You are not authorized to add schools" });
  }

  if (!req.file) {
    return res.status(400).json({ message: "Excel file is required" });
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const schools = xlsx.utils.sheet_to_json(sheet);

    let inserted = 0;
    let skipped = [];

    for (const school of schools) {
      const {
        schoolName,
        username,
        password,
        email,
        schoolMobile,
        branchName,
        fullAccess,
      } = school;

      // Validation
      if (!schoolName || !username || !password) {
        skipped.push({ username, reason: "Missing required fields" });
        continue;
      }

      const existing = await findSameUsername(username);
      if (existing.exists) {
        skipped.push({ username, reason: "Username already exists" });
        continue;
      }

      const encryptedPassword = encrypt(password);

      const newSchool = new School({
        schoolName,
        username,
        password: encryptedPassword,
        email,
        schoolMobile,
        branchName,
        fullAccess,
      });

      await newSchool.save();
      inserted++;
    }

    fs.unlinkSync(filePath); // Cleanup

    res.status(201).json({
      message: `${inserted} schools added successfully.`,
      skipped: skipped.length ? skipped : undefined,
    });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Failed to process file", error: err.message });
  }
};
