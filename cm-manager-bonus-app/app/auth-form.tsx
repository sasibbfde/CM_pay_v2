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
      if (data.session) window.location.assign(next);
      else setMessage('Account created. Check your email to confirm it, then sign in.');
    } catch (error: any) {
      setMessage(error.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24,background:'radial-gradient(circle at top left, rgba(192,146,31,.26), transparent 32rem), var(--paper)'}}>
      <section style={{width:'100%',maxWidth:440,background:'rgba(255,255,255,.92)',border:'1px solid var(--line)',borderRadius:24,padding:32,boxShadow:'var(--shadow)'}}>
        <div style={{color:'var(--gold)',fontWeight:900,letterSpacing:'.18em',fontSize:11,textTransform:'uppercase'}}>Chiang Mai Thai Dining</div>
        <h1 style={{fontFamily:'Georgia, Times New Roman, serif',fontSize:32,margin:'10px 0 6px',color:'var(--plum-deep)'}}>{mode === 'login' ? 'Manager Bonus' : 'Create bonus access'}</h1>
        <p style={{margin:'0 0 24px',color:'var(--muted)',fontSize:14}}>
          {mode === 'login' ? 'Sign in to review manager bonuses, hours, and payouts.' : 'Accounts are for authorized Chiang Mai leadership.'}
        </p>
        <form onSubmit={submit} style={{display:'grid',gap:14}}>
          <label style={{display:'grid',gap:6,fontSize:12,color:'var(--muted)',fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase'}}>
            Email
            <input type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)}
              style={{background:'#fffaf1',border:'1px solid var(--line)',borderRadius:12,color:'var(--ink)',padding:'12px 13px',fontSize:14,outline:'none'}} />
          </label>
          <label style={{display:'grid',gap:6,fontSize:12,color:'var(--muted)',fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase'}}>
            Password
            <input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} value={password} onChange={event=>setPassword(event.target.value)}
              style={{background:'#fffaf1',border:'1px solid var(--line)',borderRadius:12,color:'var(--ink)',padding:'12px 13px',fontSize:14,outline:'none'}} />
          </label>
          {mode === 'signup' && <label style={{display:'grid',gap:6,fontSize:12,color:'var(--muted)',fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase'}}>
            Confirm password
            <input type="password" autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)}
              style={{background:'#fffaf1',border:'1px solid var(--line)',borderRadius:12,color:'var(--ink)',padding:'12px 13px',fontSize:14,outline:'none'}} />
          </label>}
          {mode === 'login' && <div style={{textAlign:'right',marginTop:-6}}>
            <Link href="/forgot-password" style={{color:'var(--plum)',fontSize:12,fontWeight:700}}>Forgot password?</Link>
          </div>}
          {message && <div role="status" style={{fontSize:12,color:message.startsWith('Account created')?'var(--green)':'var(--red)',background:'var(--paper-2)',border:'1px solid var(--line)',borderRadius:10,padding:'10px 11px'}}>{message}</div>}
          <button disabled={loading} type="submit" style={{marginTop:4,background:'linear-gradient(135deg, var(--plum), var(--plum-deep))',border:0,borderRadius:12,color:'#fff',padding:'12px 14px',fontWeight:900,fontSize:14,cursor:loading?'wait':'pointer',opacity:loading?0.6:1,boxShadow:'0 14px 28px rgba(76,15,80,.2)'}}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p style={{fontSize:12,color:'var(--muted)',margin:'20px 0 0',textAlign:'center'}}>
          {mode === 'login' ? <>Need an account? <Link href={`/signup?next=${encodeURIComponent(next)}`} style={{color:'var(--plum)',fontWeight:700}}>Create one</Link></> : <>Already registered? <Link href={`/login?next=${encodeURIComponent(next)}`} style={{color:'var(--plum)',fontWeight:700}}>Sign in</Link></>}
        </p>
      </section>
    </main>
  );
}
