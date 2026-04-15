import School from "../Models/school.js";
import BranchGroup from "../Models/branchGroup.js";
import Branch from "../Models/branch.js";
import Parent from "../Models/parents.js";
import Superadmin from "../Models/superAdmin.js";
import Supervisor from "../Models/supervisor.js";
import Driver from "../Models/driver.js";


const findSameUsername = async (username) => {
  try {
    if (!username) throw new Error("Username is required");

    const queries = [
      Superadmin.findOne({ username }).lean(),
      School.findOne({ username }).lean(),
      BranchGroup.findOne({ username }).lean(),
      Branch.findOne({ username }).lean(),
      Supervisor.findOne({ username }).lean(),
      Driver.findOne({ username }).lean(),
      Parent.findOne({ username }).lean(),
    ];

    const results = await Promise.all(queries);

    if (results.some((result) => result)) {
      return { message: "Username already exists", exists: true };
    }

    return { message: "Username is available", exists: false };
  } catch (error) {
    console.error("Error finding username:", error.message);
    throw new Error("An error occurred while checking username availability.");
  }
};

export default findSameUsername;

