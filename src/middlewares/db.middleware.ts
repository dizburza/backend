import { NextFunction, Request, Response } from "express";
import connectDB from "../config/database.js";

export const dbMiddleware = async (
  _req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    next(err);
  }
};
