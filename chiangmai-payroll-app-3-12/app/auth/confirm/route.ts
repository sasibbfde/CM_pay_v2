import { EmailOtpType } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabase/route';

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type') as EmailOtpType | null;
  const requestedNext = request.nextUrl.searchParams.get('next');
  const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/';
  if (tokenHash && type) {
    const success = NextResponse.redirect(new URL(next, request.url));
    const supabase = createRouteClient(request, success);
    const { error } = await supabase.auth.verifyOtp({ token_hash:tokenHash, type });
    if (!error) return success;
  }
  return NextResponse.redirect(new URL('/auth/error', request.url));
}
