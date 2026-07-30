import Link from 'next/link';

export default function AuthErrorPage() {
  return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#0a0c10',color:'#e5e7eb'}}><div style={{textAlign:'center'}}><h1>Authentication link failed</h1><p style={{color:'#9ca3af'}}>The link may have expired. Please try signing in or create the account again.</p><Link href="/login" style={{color:'#22d3ee'}}>Return to sign in</Link></div></main>;
}
