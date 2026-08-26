import { timingSafeEqual, createHmac, randomBytes } from 'crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/** Minimal request/reply shapes (avoid depending on `fastify` package types). */
type ReqReq = {
  url?: string;
  method?: string;
  ip?: string;
  headers: Record<string, unknown>;
};

type ReqReply = {
  header: (key: string, value: string) => unknown;
  code: (status: number) => { send: (body: unknown) => unknown };
};

/** Timing-safe string compare (empty never matches). */
export function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export function headerValue(
  headers: Record<string, unknown>,
  name: string,
): string {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
  if (raw == null) return '';
  return String(raw).trim();
}

export function getAdminConfiguredSecret(): string {
  return (
    process.env.ADMIN_API_SECRET ||
    process.env.INTERNAL_API_SECRET ||
    ''
  ).trim();
}

export function parseCorsOrigins(): true | string[] {
  const raw = (process.env.CORS_ORIGINS || '').trim();
  if (!raw || raw === '*') return true;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : true;
}

type Bucket = { count: number; resetAt: number };

/** Simple in-memory sliding window rate limiter (per-process). */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  hit(key: string): { ok: boolean; remaining: number; retryAfterSec: number } {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, b);
    }
    b.count += 1;
    if (this.buckets.size > 5000) {
      for (const [k, v] of this.buckets) {
        if (v.resetAt <= now) this.buckets.delete(k);
      }
    }
    const remaining = Math.max(0, this.limit - b.count);
    const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    return { ok: b.count <= this.limit, remaining, retryAfterSec };
  }
}

const globalLimiter = new RateLimiter(
  Number(process.env.RATE_LIMIT_MAX || 120),
  Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
);
const adminAuthLimiter = new RateLimiter(12, 60_000);
const sensitiveLimiter = new RateLimiter(30, 60_000);

export function clientIp(req: ReqReq): string {
  const xf = headerValue(req.headers, 'x-forwarded-for');
  if (xf) return xf.split(',')[0]!.trim();
  return req.ip || 'unknown';
}

export function checkAdminAuthRate(ip: string): {
  ok: boolean;
  retryAfterSec: number;
} {
  const r = adminAuthLimiter.hit(`admin-auth:${ip}`);
  return { ok: r.ok, retryAfterSec: r.retryAfterSec };
}

export function checkSensitiveAdminRate(ip: string): {
  ok: boolean;
  retryAfterSec: number;
} {
  const r = sensitiveLimiter.hit(`admin-mut:${ip}`);
  return { ok: r.ok, retryAfterSec: r.retryAfterSec };
}

export type AdminSessionPayload = {
  tgId: number;
  exp: number;
  iat: number;
  jti: string;
};

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function createAdminSession(
  telegramId: number,
  ttlSec = 8 * 60 * 60,
): { token: string; expiresAt: string } {
  const secret = getAdminConfiguredSecret();
  if (!secret || secret.length < 8) {
    throw new Error('Admin secret not configured');
  }
  const now = Math.floor(Date.now() / 1000);
  const payload: AdminSessionPayload = {
    tgId: telegramId,
    iat: now,
    exp: now + ttlSec,
    jti: randomBytes(8).toString('hex'),
  };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac('sha256', secret).update(body).digest());
  return {
    token: `rfs.${body}.${sig}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export function verifyAdminSession(
  token: string,
): AdminSessionPayload | null {
  const secret = getAdminConfiguredSecret();
  if (!secret || !token.startsWith('rfs.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, body, sig] = parts;
  if (!body || !sig) return null;
  const expected = b64url(createHmac('sha256', secret).update(body).digest());
  if (!secretsEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(
      fromB64url(body).toString('utf8'),
    ) as AdminSessionPayload;
    if (
      !payload?.tgId ||
      !payload.exp ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function applySecurity(app: NestFastifyApplication) {
  const fastify = app.getHttpAdapter().getInstance();

  fastify.addHook('onRequest', async (req: ReqReq, reply: ReqReply) => {
    const url = req.url || '';
    if (!url.includes('/api/health')) {
      const r = globalLimiter.hit(`${clientIp(req)}:${req.method}`);
      reply.header('X-RateLimit-Remaining', String(r.remaining));
      if (!r.ok) {
        reply.header('Retry-After', String(r.retryAfterSec));
        return reply.code(429).send({
          statusCode: 429,
          message: 'Too many requests',
        });
      }
    }

    if (
      url.includes('/api/admin/') &&
      ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method || '')
    ) {
      const r = checkSensitiveAdminRate(clientIp(req));
      if (!r.ok) {
        reply.header('Retry-After', String(r.retryAfterSec));
        return reply.code(429).send({
          statusCode: 429,
          message: 'Admin mutation rate limit exceeded',
        });
      }
    }
  });

  fastify.addHook(
    'onSend',
    async (_req: ReqReq, reply: ReqReply, payload: unknown) => {
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('X-Frame-Options', 'DENY');
      reply.header('Referrer-Policy', 'no-referrer');
      reply.header(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=()',
      );
      reply.header('X-XSS-Protection', '0');
      if (process.env.NODE_ENV === 'production') {
        reply.header(
          'Strict-Transport-Security',
          'max-age=63072000; includeSubDomains',
        );
      }
      return payload;
    },
  );
}
