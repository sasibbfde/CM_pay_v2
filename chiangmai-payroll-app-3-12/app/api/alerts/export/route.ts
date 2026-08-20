import { NextRequest, NextResponse } from 'next/server';
import { loadPayrollAlerts, type PayrollAlert } from '@/lib/payroll-alerts';

type PdfText = { text: string; x: number; y: number; size: number };

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 42;
const LINE_HEIGHT = 13;
const ALERT_TYPES = ['OVERNIGHT_PUNCH', 'DAILY_OVER_14_HOURS', 'WEB_PUNCH_SOURCE'] as const;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function cleanText(value: unknown) {
  return String(value ?? '')
    .replace(/[–—→]/g, '-')
    .replace(/[•·]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .trim();
}

function escapePdfText(value: unknown) {
  return cleanText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function labelType(type: string) {
  if (type === 'OVERNIGHT_PUNCH') return 'Overnight punch';
  if (type === 'DAILY_OVER_14_HOURS') return 'Daily over 14 hours';
  if (type === 'WEB_PUNCH_SOURCE') return 'Web punch source';
  return type.replaceAll('_', ' ');
}

function wrapText(text: string, maxChars: number) {
  const words = cleanText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function filterAlerts(alerts: PayrollAlert[], params: URLSearchParams) {
  const type = params.get('type') || 'all';
  const severity = params.get('severity') || 'all';
  const location = (params.get('location') || 'all').toLowerCase();
  const q = (params.get('q') || '').trim().toLowerCase();
  return alerts.filter(alert => {
    if (type !== 'all' && alert.type !== type) return false;
    if (severity !== 'all' && alert.severity !== severity) return false;
    if (location !== 'all' && (alert.location || '').toLowerCase() !== location) return false;
    if (q) {
      const haystack = `${alert.employee_name} ${alert.location} ${alert.message} ${alert.type}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function addLine(pages: PdfText[][], cursor: { y: number }, text: string, size = 10, x = MARGIN, gap = LINE_HEIGHT) {
  if (!pages.length) pages.push([]);
  if (cursor.y < MARGIN) {
    pages.push([]);
    cursor.y = PAGE_HEIGHT - MARGIN;
  }
  pages[pages.length - 1].push({ text, x, y: cursor.y, size });
  cursor.y -= gap;
}

function makeAlertPdf(alerts: PayrollAlert[], meta: { from: string; to: string; filters: string }) {
  const pages: PdfText[][] = [[]];
  const cursor = { y: PAGE_HEIGHT - MARGIN };
  const critical = alerts.filter(alert => alert.severity === 'critical').length;
  const warning = alerts.length - critical;
  const overnight = alerts.filter(alert => alert.type === 'OVERNIGHT_PUNCH').length;
  const over14 = alerts.filter(alert => alert.type === 'DAILY_OVER_14_HOURS').length;
  const web = alerts.filter(alert => alert.type === 'WEB_PUNCH_SOURCE').length;

  addLine(pages, cursor, 'CM Pay Punch Alerts', 18, MARGIN, 20);
  addLine(pages, cursor, `Range: ${meta.from} to ${meta.to}`, 10);
  addLine(pages, cursor, `Generated: ${new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })}`, 10);
  addLine(pages, cursor, `Filters: ${meta.filters}`, 10, MARGIN, 18);
  addLine(pages, cursor, `Summary: ${alerts.length} alerts | ${critical} critical | ${warning} warning | ${overnight} overnight | ${over14} over 14h | ${web} web-source`, 10, MARGIN, 18);
  addLine(pages, cursor, 'Note: alerts are for manager review only and do not change payroll totals.', 9, MARGIN, 18);

  if (!alerts.length) {
    addLine(pages, cursor, 'No alerts matched these filters.', 12);
  }

  alerts.forEach((alert, index) => {
    if (cursor.y < 120) {
      pages.push([]);
      cursor.y = PAGE_HEIGHT - MARGIN;
    }
    addLine(pages, cursor, `${index + 1}. ${alert.employee_name} - ${alert.alert_date}`, 12, MARGIN, 15);
    addLine(pages, cursor, `${labelType(alert.type)} | ${alert.severity.toUpperCase()} | ${alert.location || 'Unknown location'}`, 9, MARGIN + 12, 13);
    for (const line of wrapText(alert.message, 92)) {
      addLine(pages, cursor, line, 9, MARGIN + 12, 12);
    }
    cursor.y -= 6;
  });

  for (let index = 0; index < pages.length; index += 1) {
    pages[index].push({ text: `Page ${index + 1} of ${pages.length}`, x: PAGE_WIDTH - 100, y: 24, size: 8 });
  }

  return buildPdf(pages);
}

function buildPdf(pages: PdfText[][]) {
  const objects: string[] = [''];
  const reserve = () => {
    objects.push('');
    return objects.length - 1;
  };
  const setObject = (id: number, body: string) => {
    objects[id] = body;
  };

  const catalogId = reserve();
  const pagesId = reserve();
  const fontId = reserve();
  setObject(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const pageIds: number[] = [];
  for (const page of pages) {
    const contentId = reserve();
    const pageId = reserve();
    pageIds.push(pageId);
    const stream = page
      .map(line => `BT /F1 ${line.size} Tf ${line.x.toFixed(2)} ${line.y.toFixed(2)} Td (${escapePdfText(line.text)}) Tj ET`)
      .join('\n');
    setObject(contentId, `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
    setObject(pageId, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
  }

  setObject(pagesId, `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  setObject(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, 'utf8');
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const from = params.get('from') || todayIso();
    const to = params.get('to') || from;
    const type = params.get('type') || 'all';
    const safeType = type === 'all' || ALERT_TYPES.includes(type as any) ? type : 'all';
    const severity = params.get('severity') === 'critical' || params.get('severity') === 'warning' ? params.get('severity')! : 'all';
    const location = params.get('location') || 'all';
    const q = params.get('q') || '';

    const { alerts } = await loadPayrollAlerts({ from, to });
    const filtered = filterAlerts(alerts, new URLSearchParams({
      type: safeType,
      severity,
      location,
      q,
    }));
    const filters = [
      safeType === 'all' ? 'all alert types' : labelType(safeType),
      severity === 'all' ? 'all severities' : severity,
      location === 'all' ? 'all locations' : location,
      q ? `search "${cleanText(q)}"` : '',
    ].filter(Boolean).join(', ');
    const pdf = makeAlertPdf(filtered, { from, to, filters });
    const filename = `cm-pay-alerts_${from}_to_${to}.pdf`;

    return new NextResponse(pdf, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message || 'Failed to export alert PDF' }, { status: 500 });
  }
}
