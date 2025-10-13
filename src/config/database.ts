import mongoose from "mongoose";
import { ENV } from "./environment";

let isConnected = false;

const connectDB = async () => {
  if (isConnected) {
    console.log("Using existing MongoDB connection");
    return;
  }
  try {
    if (!ENV.MONGODB_URI) {
      console.error("MONGODB_URI is not defined");
      throw new Error("MONGODB_URI is not defined");
    }
    console.log(
      "Connecting to MongoDB with URI:",
      ENV.MONGODB_URI.replace(/:.*@/, ":<hidden>@")
    ); // Hide password
    await mongoose.connect(ENV.MONGODB_URI, {
      serverSelectionTimeoutMS: 8000, // Fit Vercel Hobby plan
      maxPoolSize: 10,
      retryWrites: true,
      w: "majority",
      appName: "Dizburza",
    });
    isConnected = true;
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    isConnected = false; // Allow retries
    throw error;
  }
};

export default connectDB;
