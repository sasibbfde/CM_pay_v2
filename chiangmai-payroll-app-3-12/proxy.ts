import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function hasCronAccess(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const cronPath = req.nextUrl.pathname.startsWith('/api/cron/')
    || req.nextUrl.pathname === '/api/7shifts/sync'
    || req.nextUrl.pathname === '/api/sales-sync';
  return Boolean(cronPath && secret && safeEqual(req.headers.get('authorization') || '', `Bearer ${secret}`));
}

function hasAppAccess(req: NextRequest) {
  const username = process.env.APP_USERNAME;
  const password = process.env.APP_PASSWORD;
  if (!username || !password) return process.env.NODE_ENV !== 'production';

  const header = req.headers.get('authorization') || '';
  if (!header.startsWith('Basic ')) return false;

  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return false;
    return safeEqual(decoded.slice(0, separator), username)
      && safeEqual(decoded.slice(separator + 1), password);
  } catch {
    return false;
  }
}

export function proxy(req: NextRequest) {
  if (hasCronAccess(req) || hasAppAccess(req)) return NextResponse.next();

  const configured = Boolean(process.env.APP_USERNAME && process.env.APP_PASSWORD);
  return new NextResponse(
    configured ? 'Authentication required' : 'APP_USERNAME and APP_PASSWORD must be configured',
    {
      status: configured ? 401 : 503,
      headers: configured ? { 'WWW-Authenticate': 'Basic realm="CM Payroll", charset="UTF-8"' } : {},
    },
  );
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
