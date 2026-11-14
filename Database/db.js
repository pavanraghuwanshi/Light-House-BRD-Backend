import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/lighthouse_db';

let isConnected = false;

export const connectDB = async () => {
  if (isConnected) return mongoose.connection;
  try {
    const conn = await mongoose.connect(mongoUri, {
      maxPoolSize: 20,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 15000,
    });
    isConnected = true;
    console.log(`Connected to Database (${conn.connection.name || 'lighthouse_db'}) successfully.`);
    return conn.connection;
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    return null;
  }
};

// Immediately connect to the single database
connectDB();

// Single connection exports (with backward-compatible dbConnections for models)
export const dbConnection = mongoose.connection;
export const dbConnections = {
  db1: mongoose.connection,
  db2: mongoose.connection,
};

export default connectDB;
