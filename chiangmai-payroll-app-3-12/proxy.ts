import { createServerClient } from '@supabase/ssr';
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/signup', '/auth/callback', '/auth/confirm', '/auth/error'];

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

function copyAuthState(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach(cookie => target.cookies.set(cookie));
  for (const name of ['cache-control', 'expires', 'pragma']) {
    const value = source.headers.get(name);
    if (value) target.headers.set(name, value);
  }
  return target;
}

export async function proxy(req: NextRequest) {
  if (hasCronAccess(req)) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return new NextResponse('Supabase authentication is not configured', { status: 503 });
  }

  let response = NextResponse.next({ request: req });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        response = NextResponse.next({ request: req });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const authenticated = !error && Boolean(data?.claims?.sub);
  const isPublic = PUBLIC_PATHS.some(path => req.nextUrl.pathname.startsWith(path));

  if (!authenticated && !isPublic) {
    if (req.nextUrl.pathname.startsWith('/api/')) {
      return copyAuthState(response, NextResponse.json({ error:'Unauthorized' }, { status:401 }));
    }
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    loginUrl.searchParams.set('next', `${req.nextUrl.pathname}${req.nextUrl.search}`);
    return copyAuthState(response, NextResponse.redirect(loginUrl));
  }

  if (authenticated && (req.nextUrl.pathname === '/login' || req.nextUrl.pathname === '/signup')) {
    const homeUrl = req.nextUrl.clone();
    homeUrl.pathname = '/';
    homeUrl.search = '';
    return copyAuthState(response, NextResponse.redirect(homeUrl));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
