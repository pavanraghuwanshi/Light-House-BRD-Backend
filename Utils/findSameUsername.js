import User from "../Models/user.js";

const findSameUsername = async (username) => {
  try {
    if (!username) throw new Error("Username is required");

    const existingUser = await User.findOne({ username: username.toLowerCase().trim() }).lean();

    if (existingUser) {
      return { message: "Username already exists", exists: true };
    }

    return { message: "Username is available", exists: false };
  } catch (error) {
    console.error("Error finding username:", error.message);
    throw new Error("An error occurred while checking username availability.");
  }
};

export default findSameUsername;
