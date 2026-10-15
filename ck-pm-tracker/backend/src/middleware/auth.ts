import { Request, Response, NextFunction } from "express";

export interface AuthedRequest extends Request {
  user?: { id: string; role: "admin" | "tech" };
}

/**
 * STUB — no real identity yet. Before deploy, replace this with Google Workspace
 * SSO (or Entra) token validation that sets req.user from a verified token.
 * For now, dev headers let you exercise role gating locally:
 *   x-dev-user: <id>    x-dev-role: admin|tech   (defaults: dev-user / admin)
 */
export function auth(req: AuthedRequest, _res: Response, next: NextFunction) {
  req.user = {
    id: req.header("x-dev-user") || "dev-user",
    role: (req.header("x-dev-role") as "admin" | "tech") || "admin",
  };
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "admin_required" });
  next();
}
