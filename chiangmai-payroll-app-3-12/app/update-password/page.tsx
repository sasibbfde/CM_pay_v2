'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('Checking your reset link…');
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data, error }) => {
      if (error || !data.session) {
        setMessage('This reset link is invalid or expired. Request a new one.');
        return;
      }
      setReady(true);
      setMessage('');
    });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setMessage('Passwords do not match');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const { error } = await createClient().auth.updateUser({ password });
      if (error) throw error;
      setSaved(true);
      setReady(false);
      setMessage('Password updated successfully. You can now continue to CM Pay.');
    } catch (error: any) {
      setMessage(error.message || 'Unable to update your password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#0a0c10',padding:24,color:'#e5e7eb'}}>
      <div style={{width:'100%',maxWidth:420,background:'#131720',border:'1px solid rgba(255,255,255,0.09)',borderRadius:16,padding:28,boxShadow:'0 24px 80px rgba(0,0,0,0.35)'}}>
        <div style={{color:'#22d3ee',fontWeight:800,letterSpacing:'0.08em',fontSize:13}}>CM PAY</div>
        <h1 style={{fontSize:26,margin:'12px 0 4px',color:'#f9fafb'}}>Choose a new password</h1>
        <p style={{margin:'0 0 24px',color:'#6b7280',fontSize:13}}>Use at least 8 characters.</p>
        {ready && <form onSubmit={submit} style={{display:'grid',gap:14}}>
          <label style={{display:'grid',gap:6,fontSize:12,color:'#9ca3af'}}>New password
            <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={event=>setPassword(event.target.value)} style={{background:'#0d1117',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,color:'#f9fafb',padding:'11px 12px',fontSize:14,outline:'none'}} />
          </label>
          <label style={{display:'grid',gap:6,fontSize:12,color:'#9ca3af'}}>Confirm new password
            <input type="password" autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} style={{background:'#0d1117',border:'1px solid rgba(255,255,255,0.12)',borderRadius:8,color:'#f9fafb',padding:'11px 12px',fontSize:14,outline:'none'}} />
          </label>
          <button disabled={loading} type="submit" style={{marginTop:4,background:'#22d3ee',border:0,borderRadius:8,color:'#071014',padding:'11px 14px',fontWeight:700,fontSize:14,cursor:loading?'wait':'pointer',opacity:loading?0.6:1}}>{loading?'Saving…':'Update password'}</button>
        </form>}
        {message && <div role="status" style={{fontSize:12,color:saved?'#34d399':ready?'#f87171':'#9ca3af',background:'rgba(255,255,255,0.04)',borderRadius:7,padding:'9px 10px',marginTop:ready?14:0}}>{message}</div>}
        <p style={{fontSize:12,color:'#6b7280',margin:'20px 0 0',textAlign:'center'}}><Link href={saved?'/':'/forgot-password'} style={{color:'#22d3ee'}}>{saved?'Continue to CM Pay':'Request another reset link'}</Link></p>
      </div>
    </main>
  );
}
