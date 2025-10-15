import { Request, Response, NextFunction } from "express";

/**
 * Custom sanitizer to prevent NoSQL injection
 * Compatible with Express 5 (does not reassign req.query)
 */
export const sanitizeMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const sanitizeObject = (obj: any) => {
    if (!obj || typeof obj !== "object") return;
    for (const key in obj) {
      if (key.startsWith("$") || key.includes(".")) {
        delete obj[key];
      } else if (typeof obj[key] === "object") {
        sanitizeObject(obj[key]);
      }
    }
  };

  sanitizeObject(req.body);
  sanitizeObject(req.params);
  sanitizeObject(req.query);

  next();
};
