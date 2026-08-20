'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const DAILY_LIMIT = 3;
const STORAGE_KEY = 'cm-pay-ai-agent-v2';
const COUNT_KEY = 'cm-pay-ai-agent-count-v2';

function todayKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

function loadCount() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COUNT_KEY) || '{}');
    if (parsed.date !== todayKey()) return 0;
    return Number(parsed.count || 0);
  } catch {
    return 0;
  }
}

function saveCount(count: number) {
  window.localStorage.setItem(COUNT_KEY, JSON.stringify({ date: todayKey(), count }));
}

function shortAnswer(text: string) {
  return text.length > 1200 ? `${text.slice(0, 1200).trim()}…` : text;
}

function renderAnswer(text: string) {
  const parts = shortAnswer(text).split(/((?:https?:\/\/|\/api\/)[^\s]+)/g);
  return parts.map((part, index) => {
    if (!/^(?:https?:\/\/|\/api\/)/.test(part)) return part;
    return (
      <a
        key={`${part}-${index}`}
        href={part}
        target={part.startsWith('http') ? '_blank' : undefined}
        rel={part.startsWith('http') ? 'noreferrer' : undefined}
        style={{ color: 'var(--accent)', textDecoration: 'underline', fontWeight: 800 }}
      >
        {part}
      </a>
    );
  });
}

export default function AiAgentWidget() {
  const pathname = usePathname();
  const hidden = pathname === '/login' || pathname === '/signup' || pathname.startsWith('/auth/');
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [used, setUsed] = useState(0);
  const [position, setPosition] = useState({ x: 24, y: 24 });
  const drag = useRef<{ pointerId: number; startX: number; startY: number; x: number; y: number } | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (hidden) return;
    setUsed(loadCount());
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) setMessages(saved.slice(-8));
    } catch {}
  }, [hidden]);

  useEffect(() => {
    if (hidden) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-8)));
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [hidden, messages]);

  const remaining = Math.max(0, DAILY_LIMIT - used);

  const suggestions = useMemo(() => [
    'Show manager hours for this pay period',
    'Check labour burden for yesterday',
    'Give management insights for Aug 3',
    'Which employees are multi-location?',
    'Any wage changes or missing wages?',
    'Show review rows',
  ], []);

  if (hidden) return null;

  function startDrag(event: React.PointerEvent<HTMLButtonElement>) {
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: position.x, y: position.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const nextX = Math.max(8, Math.min(window.innerWidth - 86, drag.current.x - (event.clientX - drag.current.startX)));
    const nextY = Math.max(8, Math.min(window.innerHeight - 86, drag.current.y - (event.clientY - drag.current.startY)));
    setPosition({ x: nextX, y: nextY });
  }

  function stopDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const moved = Math.abs(event.clientX - drag.current.startX) + Math.abs(event.clientY - drag.current.startY);
    drag.current = null;
    if (moved < 4) setOpen(value => !value);
  }

  async function ask(message = input) {
    const clean = message.trim();
    if (!clean || loading) return;
    if (remaining <= 0) {
      setMessages(current => [...current, { role: 'assistant', content: 'Daily AI Agent limit reached. You have 3 questions per day so payroll data stays controlled and costs stay low.' }]);
      return;
    }
    setInput('');
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: clean }];
    setMessages(nextMessages);
    setLoading(true);
    try {
      const response = await fetch('/api/ai-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: clean, history: messages.slice(-6) }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || 'AI Agent could not answer.');
      const count = used + 1;
      setUsed(count);
      saveCount(count);
      setMessages(current => [...current, { role: 'assistant', content: data.answer || 'No answer returned.' }]);
    } catch (error: any) {
      setMessages(current => [...current, { role: 'assistant', content: `😵‍💫 I could not answer yet: ${error.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {open && (
        <section
          aria-label="CM Pay AI Payroll Agent"
          style={{
            position: 'fixed',
            right: Math.max(12, position.x),
            bottom: Math.max(92, position.y + 72),
            width: 'min(410px, calc(100vw - 28px))',
            maxHeight: 'min(680px, calc(100vh - 120px))',
            background: 'var(--surface)',
            color: 'var(--text)',
            border: '1px solid var(--border2)',
            borderRadius: 18,
            boxShadow: 'var(--shadow-lg)',
            zIndex: 260,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '14px 15px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="ai-agent-mini-avatar">🤓<span>💻</span></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>AI Payroll Agent</div>
              <div style={{ color: 'var(--muted)', fontSize: 11 }}>Read-only CM Pay V2 answers · private · {remaining}/3 left today</div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'transparent', border: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>×</button>
          </div>

          <div style={{ padding: 12, maxHeight: 390, overflowY: 'auto' }}>
            {messages.length === 0 && (
              <div style={{ border: '1px solid var(--border)', background: 'var(--surface2)', borderRadius: 12, padding: 12, color: 'var(--muted)', fontSize: 12, lineHeight: 1.5 }}>
                🤓 Ask about payroll hours, wages, managers, multi-location staff, rule labels, missing wages, labour burden, or management insights. I won’t change payroll data.
              </div>
            )}
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} style={{ display: 'flex', justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start', marginTop: 10 }}>
                <div style={{
                  maxWidth: '88%',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.5,
                  borderRadius: 14,
                  padding: '9px 11px',
                  fontSize: 12,
                  color: message.role === 'user' ? '#081018' : 'var(--text)',
                  background: message.role === 'user' ? '#22d3ee' : 'var(--surface2)',
                  border: message.role === 'user' ? '1px solid rgba(34,211,238,.45)' : '1px solid var(--border)',
                }}>
                  {message.role === 'assistant' ? renderAnswer(message.content) : message.content}
                </div>
              </div>
            ))}
            {loading && <div className="ai-agent-thinking">🤓 Checking CM Pay privately…</div>}
            <div ref={endRef} />
          </div>

          <div style={{ padding: '0 12px 10px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {messages.length === 0 && suggestions.map(item => (
              <button key={item} onClick={() => ask(item)} style={{ background: 'rgba(34,211,238,.08)', border: '1px solid rgba(34,211,238,.20)', color: 'var(--accent)', borderRadius: 999, padding: '5px 8px', fontSize: 10, cursor: 'pointer' }}>
                {item}
              </button>
            ))}
          </div>

          <form
            onSubmit={event => { event.preventDefault(); ask(); }}
            style={{ borderTop: '1px solid var(--border)', padding: 12, display: 'flex', gap: 8 }}
          >
            <input
              value={input}
              onChange={event => setInput(event.target.value)}
              placeholder={remaining > 0 ? 'Ask about CM Pay V2…' : 'Daily limit reached'}
              disabled={loading || remaining <= 0}
              style={{
                flex: 1,
                background: 'var(--surface2)',
                border: '1px solid var(--border2)',
                color: 'var(--text)',
                borderRadius: 10,
                padding: '9px 10px',
                outline: 'none',
                fontSize: 12,
              }}
            />
            <button
              disabled={loading || remaining <= 0 || !input.trim()}
              style={{
                background: loading || remaining <= 0 ? 'var(--surface2)' : 'linear-gradient(135deg,#22d3ee,#a78bfa)',
                border: 0,
                color: loading || remaining <= 0 ? 'var(--muted)' : '#081018',
                borderRadius: 10,
                padding: '0 12px',
                fontWeight: 800,
                cursor: loading || remaining <= 0 ? 'not-allowed' : 'pointer',
              }}
            >
              Ask
            </button>
          </form>
        </section>
      )}

      <button
        aria-label="Open AI Payroll Agent"
        title="Drag me anywhere · AI Payroll Agent"
        className="ai-agent-orb"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        style={{
          position: 'fixed',
          right: position.x,
          bottom: position.y,
          width: 66,
          height: 66,
          borderRadius: 22,
          border: '1px solid rgba(34,211,238,.38)',
          background: 'linear-gradient(135deg,#0f172a,#1e1b4b)',
          color: '#fff',
          boxShadow: '0 18px 42px rgba(0,0,0,.35)',
          zIndex: 260,
          cursor: 'grab',
          display: 'grid',
          placeItems: 'center',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <span className="ai-agent-orb-face">🤓</span>
        <span className="ai-agent-orb-laptop">💻</span>
        <span style={{ position: 'absolute', right: -2, top: -3, background: '#fbbf24', color: '#1f1300', borderRadius: 999, padding: '1px 5px', fontSize: 10, fontWeight: 900 }}>AI</span>
      </button>
    </>
  );
}
