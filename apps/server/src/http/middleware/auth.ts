import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { forbidden, unauthorized } from '../../lib/errors.js';
import { verifyAccessToken, type AccessClaims } from '../../lib/jwt.js';

export type AuthedRequest = Request & { auth: AccessClaims };

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

export const requireAuth: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const token = bearer(req);
  if (!token) {
    next(unauthorized());
    return;
  }

  const claims = await verifyAccessToken(token);
  if (!claims) {
    next(unauthorized('نشست شما منقضی شده است'));
    return;
  }

  (req as AuthedRequest).auth = claims;
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  const auth = (req as AuthedRequest).auth;
  if (!auth?.isAdmin) {
    next(forbidden('این بخش فقط برای مدیر سرور است'));
    return;
  }
  next();
};

export function currentUser(req: Request): AccessClaims {
  const auth = (req as AuthedRequest).auth;
  if (!auth) throw unauthorized();
  return auth;
}
