'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const callback = new URL('/auth/callback', window.location.origin);
      callback.searchParams.set('next', '/update-password');
      const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: callback.toString(),
      });
      if (error) throw error;
      setSent(true);
      setMessage('Password reset email sent. Check your inbox and spam folder.');
    } catch (error: any) {
      setMessage(error.message || 'Unable to send the reset email');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#0a0c10',padding:24,color:'#e5e7eb'}}>
      <div style={{width:'100%',maxWidth:420,background:'#131720',border:'1px solid rgba(255,255,255,0.09)',borderRadius:16,padding:28,boxShadow:'0 24px 80px rgba(0,0,0,0.35)'}}>
        <div style={{color:'#22d3ee',fontWeight:800,letterSpacing:'0.08em',fontSize:13}}>CM PAY</div>
        <h1 style={{fontSize:26,margin:'12px 0 4px',color:'#f9fafb'}}>Reset your password</h1>
        <p style={{margin:'0 0 24px',color:'#6b7280',fontSize:13}}>Enter your account email and we will send you a secure reset link.</p>
        <form onSubmit={submit} style={{display:'grid',gap:14}}>
          <label style={{display:'grid',gap:6,fontSize:12,color:'#9ca3af'}}>
            Email
            <input type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)}
              style={{background:'#0d1117',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,color:'#f9fafb',padding:'11px 12px',fontSize:14,outline:'none'}} />
          </label>
          {message && <div role="status" style={{fontSize:12,color:sent?'#34d399':'#f87171',background:'rgba(255,255,255,0.04)',borderRadius:7,padding:'9px 10px'}}>{message}</div>}
          <button disabled={loading || sent} type="submit" style={{marginTop:4,background:'#22d3ee',border:0,borderRadius:8,color:'#071014',padding:'11px 14px',fontWeight:700,fontSize:14,cursor:loading?'wait':'pointer',opacity:loading||sent?0.6:1}}>
            {loading ? 'Sending…' : sent ? 'Email sent' : 'Send reset email'}
          </button>
        </form>
        <p style={{fontSize:12,color:'#6b7280',margin:'20px 0 0',textAlign:'center'}}><Link href="/login" style={{color:'#22d3ee'}}>Return to sign in</Link></p>
      </div>
    </main>
  );
}
