import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabase/route';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const requestedNext = request.nextUrl.searchParams.get('next');
  const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/';
  if (code) {
    const success = NextResponse.redirect(new URL(next, request.url));
    const supabase = createRouteClient(request, success);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return success;
  }
  return NextResponse.redirect(new URL('/auth/error', request.url));
}
