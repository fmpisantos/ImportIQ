import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

/** Wrap an async handler so thrown errors reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

/** Central error handler: zod → 400, everything else → 500, always JSON. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Invalid request", details: err.flatten() });
    return;
  }
  console.error("[api] unhandled error:", err);
  res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
}
