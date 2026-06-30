'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function AuthForm({ mode }: { mode:'login'|'signup' }) {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const requestedNext = searchParams.get('next');
  const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const supabase = createClient();
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.assign(next);
        return;
      }

      if (password !== confirmPassword) throw new Error('Passwords do not match');

      const callback = new URL('/auth/callback', window.location.origin);
      callback.searchParams.set('next', next);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: callback.toString() },
      });
      if (error) throw error;
      if (data.session) {
        window.location.assign(next);
      } else {
        setMessage('Account created. Check your email to confirm it, then sign in.');
      }
    } catch (error: any) {
      setMessage(error.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#0a0c10',padding:24,color:'#e5e7eb'}}>
      <div style={{width:'100%',maxWidth:420,background:'#131720',border:'1px solid rgba(255,255,255,0.09)',borderRadius:16,padding:28,boxShadow:'0 24px 80px rgba(0,0,0,0.35)'}}>
        <div style={{color:'#22d3ee',fontWeight:800,letterSpacing:'0.08em',fontSize:13}}>CM PAY</div>
        <h1 style={{fontSize:26,margin:'12px 0 4px',color:'#f9fafb'}}>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p style={{margin:'0 0 24px',color:'#6b7280',fontSize:13}}>
          {mode === 'login' ? 'Sign in to access payroll operations.' : 'Accounts are for authorized Chiang Mai staff.'}
        </p>
        <form onSubmit={submit} style={{display:'grid',gap:14}}>
          <label style={{display:'grid',gap:6,fontSize:12,color:'#9ca3af'}}>
            Email
            <input type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)}
              style={{background:'#0d1117',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,color:'#f9fafb',padding:'11px 12px',fontSize:14,outline:'none'}} />
          </label>
          <label style={{display:'grid',gap:6,fontSize:12,color:'#9ca3af'}}>
            Password
            <input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} value={password} onChange={event=>setPassword(event.target.value)}
              style={{background:'#0d1117',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,color:'#f9fafb',padding:'11px 12px',fontSize:14,outline:'none'}} />
          </label>
          {mode === 'signup' && <label style={{display:'grid',gap:6,fontSize:12,color:'#9ca3af'}}>
            Confirm password
            <input type="password" autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)}
              style={{background:'#0d1117',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,color:'#f9fafb',padding:'11px 12px',fontSize:14,outline:'none'}} />
          </label>}
          {mode === 'login' && <div style={{textAlign:'right',marginTop:-6}}>
            <Link href="/forgot-password" style={{color:'#22d3ee',fontSize:12}}>Forgot password?</Link>
          </div>}
          {message && <div role="status" style={{fontSize:12,color:message.startsWith('Account created')?'#34d399':'#f87171',background:'rgba(255,255,255,0.04)',borderRadius:7,padding:'9px 10px'}}>{message}</div>}
          <button disabled={loading} type="submit" style={{marginTop:4,background:'#22d3ee',border:0,borderRadius:8,color:'#071014',padding:'11px 14px',fontWeight:700,fontSize:14,cursor:loading?'wait':'pointer',opacity:loading?0.6:1}}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p style={{fontSize:12,color:'#6b7280',margin:'20px 0 0',textAlign:'center'}}>
          {mode === 'login' ? <>Need an account? <Link href={`/signup?next=${encodeURIComponent(next)}`} style={{color:'#22d3ee'}}>Create one</Link></> : <>Already registered? <Link href={`/login?next=${encodeURIComponent(next)}`} style={{color:'#22d3ee'}}>Sign in</Link></>}
        </p>
      </div>
    </main>
  );
}
