import mongoSanitize from "express-mongo-sanitize";

// Prevent NoSQL injection
export const sanitizeMiddleware = mongoSanitize({
  replaceWith: "_",
});