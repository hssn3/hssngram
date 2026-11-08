import { SignJWT, jwtVerify } from 'jose';
import { env } from '../env.js';

const secret = new TextEncoder().encode(env.JWT_SECRET);

export type AccessClaims = {
  userId: string;
  isAdmin: boolean;
  sessionId: string;
};

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ adm: claims.isAdmin, sid: claims.sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setIssuer('hssngram')
    .setAudience('hssngram-web')
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: 'hssngram',
      audience: 'hssngram-web',
    });

    if (!payload.sub || typeof payload.sid !== 'string') return null;
    return {
      userId: payload.sub,
      isAdmin: payload.adm === true,
      sessionId: payload.sid,
    };
  } catch {
    return null;
  }
}
