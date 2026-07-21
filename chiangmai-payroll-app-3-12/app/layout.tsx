import './globals.css';
import type { Metadata } from 'next';
import Nav from './nav';

export const metadata: Metadata = {
  title: 'CM Payroll — Chiang Mai Group',
  description: 'Biweekly payroll management powered by 7shifts',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <script
          dangerouslySetInnerHTML={{
            __html: "try{var t=localStorage.getItem('cm-pay-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){}",
          }}
        />
      </head>
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
