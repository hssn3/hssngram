import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { env, isProd } from '../env.js';
import { HttpError } from '../lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes, avatarRoutes } from './routes/users.js';
import { chatRoutes, channelRoutes } from './routes/chats.js';
import { inviteRoutes } from './routes/extras.js';
import { messageRoutes } from './routes/messages.js';
import { mediaRoutes, uploadRoutes } from './routes/uploads.js';
import { callRoutes } from './routes/calls.js';
import { pushRoutes } from './routes/push.js';
import { adminRoutes } from './routes/admin.js';
import { adminSupportRoutes, supportRoutes } from './routes/support.js';
import { extrasRoutes } from './routes/extras.js';
import { insightRoutes } from './routes/insights.js';
import { connectionCount } from '../services/presence.js';
import { pushEnabled } from '../services/push.js';
import { storage } from '../storage/index.js';

const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('permissions-policy', 'camera=(self), microphone=(self), display-capture=(self)');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader(
    'content-security-policy',
    [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob: data:",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  );
  next();
};

export function createApp(): express.Express {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      version: '0.2.0',
      uptime: Math.round(process.uptime()),
      connections: connectionCount(),
      storage: storage().kind,
      push: pushEnabled(),
    });
  });

  app.use('/api/auth', authRoutes());
  app.use('/api', insightRoutes());
  app.use('/api', extrasRoutes());
  app.use('/api/users', userRoutes());
  app.use('/api/avatars', avatarRoutes());
  app.use('/api/chats', channelRoutes());
  app.use('/api/chats', chatRoutes());
  app.use('/api/invites', inviteRoutes());
  app.use('/api/uploads', uploadRoutes());
  app.use('/api/media', mediaRoutes());
  app.use('/api/calls', callRoutes());
  app.use('/api/push', pushRoutes());
  app.use('/api/admin/support', adminSupportRoutes());
  app.use('/api/admin', adminRoutes());
  app.use('/api/support', supportRoutes());
  app.use('/api', messageRoutes());

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'این مسیر وجود ندارد' });
  });

  if (isProd) {
    const dist = resolve(process.cwd(), env.WEB_DIST);
    const indexFile = join(dist, 'index.html');

    app.use(
      express.static(dist, {
        index: false,
        maxAge: '1y',
        immutable: true,
        setHeaders: (res, path) => {
          if (path.endsWith('index.html') || path.endsWith('sw.js')) {
            res.setHeader('cache-control', 'no-cache');
          }
        },
      }),
    );

    app.get(/^(?!\/api\/|\/socket\.io\/).*/, (_req, res) => {
      if (existsSync(indexFile)) {
        res.setHeader('cache-control', 'no-cache');
        res.sendFile(indexFile);
        return;
      }
      res
        .status(503)
        .type('text/plain; charset=utf-8')
        .send('وب‌اپلیکیشن ساخته نشده است. ابتدا npm run build را اجرا کنید.');
    });
  }

  const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({
        error: error.code,
        message: error.message,
        details: error.details ?? undefined,
      });
      return;
    }

    if ((error as { type?: string }).type === 'entity.too.large') {
      res.status(413).json({ error: 'payload_too_large', message: 'حجم درخواست بیش از حد مجاز است' });
      return;
    }

    if ((error as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'bad_request', message: 'بدنه درخواست معتبر نیست' });
      return;
    }

    console.error(`[http] ${req.method} ${req.originalUrl}`, error);
    res.status(500).json({ error: 'internal_error', message: 'خطای داخلی سرور' });
  };

  app.use(errorHandler);
  return app;
}




