import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import ExcelJS from 'exceljs';

async function fetchAll(supabase: any, table: string, filterFn?: (q: any) => any) {
  const all: any[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    let q = supabase.from(table).select('*').range(from, from + PAGE - 1);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export async function GET(req: NextRequest) {
  try {
    const sp      = req.nextUrl.searchParams;
    const from    = sp.get('from') || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const to      = sp.get('to')   || new Date().toISOString().split('T')[0];
    const format  = sp.get('format') || 'excel';
    const supabase = getSupabaseAdmin();

    const [punches, rules, sales] = await Promise.all([
      fetchAll(supabase, 'punches', q => q.gte('clocked_in', from).lte('clocked_in', to + 'T23:59:59')),
      fetchAll(supabase, 'employee_rules', q => q.eq('active', true)),
      fetchAll(supabase, 'daily_sales',    q => q.gte('sale_date', from).lte('sale_date', to)),
    ]);

    // Aggregate by employee
    const empMap = new Map<string, any>();
    for (const p of punches) {
      const k = p.employee_name;
      if (!empMap.has(k)) empMap.set(k, { name: k, location: p.location, dept: p.department, role: p.role, wage: +p.wage||0, hours: 0, payroll: 0, cash: 0 });
      const e = empMap.get(k);
      const h = +p.hours || 0;
      const w = +p.wage  || 0;
      const rule = rules.find((r: any) => r.employee_name?.toLowerCase() === k.toLowerCase());
      if (rule?.rule_type === 'CASH_ONLY') { e.cash += h * w; }
      else { e.payroll += h * w; }
      e.hours += h;
    }

    // Aggregate sales by location
    const salesByLoc = new Map<string, number>();
    for (const s of sales) salesByLoc.set(s.location, (salesByLoc.get(s.location)||0) + (+s.net_sales||+s.gross_sales||0));

    // Location summary
    const locMap = new Map<string, any>();
    for (const [, e] of empMap) {
      const l = e.location || 'Unknown';
      if (!locMap.has(l)) locMap.set(l, { loc: l, staff: 0, hours: 0, payroll: 0, cash: 0 });
      const lv = locMap.get(l);
      lv.staff++; lv.hours += e.hours; lv.payroll += e.payroll; lv.cash += e.cash;
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'CM Payroll';

    // Sheet 1: Employee detail
    const ws1 = wb.addWorksheet('Employee Detail');
    ws1.columns = [
      {header:'Employee',width:30},{header:'Location',width:22},{header:'Department',width:18},
      {header:'Role',width:18},{header:'Hours',width:10},{header:'Wage ($/hr)',width:12},
      {header:'Payroll $',width:14},{header:'Cash $',width:14},{header:'Total $',width:14},
    ];
    ws1.getRow(1).font = { bold: true };
    ws1.getRow(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1a1f2e'} };
    ws1.getRow(1).font = { bold:true, color:{argb:'FFe5e7eb'} };
    for (const [, e] of [...empMap.entries()].sort((a,b)=>a[0].localeCompare(b[0]))) {
      ws1.addRow([e.name, e.location||'', e.dept||'', e.role||'', +e.hours.toFixed(2), +e.wage.toFixed(2), +e.payroll.toFixed(2), +e.cash.toFixed(2), +(e.payroll+e.cash).toFixed(2)]);
    }
    // Total row
    const totalRow = ws1.addRow(['TOTAL','','','',
      [...empMap.values()].reduce((s,e)=>s+e.hours,0).toFixed(2),'',
      [...empMap.values()].reduce((s,e)=>s+e.payroll,0).toFixed(2),
      [...empMap.values()].reduce((s,e)=>s+e.cash,0).toFixed(2),
      [...empMap.values()].reduce((s,e)=>s+e.payroll+e.cash,0).toFixed(2)]);
    totalRow.font = { bold:true };

    // Sheet 2: Location summary with sales
    const ws2 = wb.addWorksheet('Location Summary');
    ws2.columns = [
      {header:'Location',width:25},{header:'Staff',width:8},{header:'Hours',width:10},
      {header:'Payroll $',width:14},{header:'Cash $',width:14},{header:'Total Labour $',width:16},
      {header:'Cost/hr',width:10},{header:'Sales $',width:14},{header:'Labour %',width:12},
    ];
    ws2.getRow(1).font = { bold:true, color:{argb:'FFe5e7eb'} };
    ws2.getRow(1).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1a1f2e'} };
    for (const [loc, lv] of [...locMap.entries()].sort((a,b)=>b[1].payroll+b[1].cash - a[1].payroll-a[1].cash)) {
      const sale   = salesByLoc.get(loc) || 0;
      const total  = lv.payroll + lv.cash;
      const labPct = sale > 0 ? ((total/sale)*100).toFixed(1)+'%' : '—';
      const costhr = lv.hours > 0 ? (total/lv.hours).toFixed(2) : '0';
      ws2.addRow([loc, lv.staff, +lv.hours.toFixed(1), +lv.payroll.toFixed(2), +lv.cash.toFixed(2), +total.toFixed(2), +costhr, sale||'', labPct]);
    }

    // Sheet 3: Daily sales
    if (sales.length > 0) {
      const ws3 = wb.addWorksheet('Sales Data');
      ws3.columns = [{header:'Date',width:12},{header:'Location',width:22},{header:'Net Sales',width:14},{header:'Gross Sales',width:14},{header:'Covers',width:10},{header:'Notes',width:30}];
      ws3.getRow(1).font = { bold:true };
      for (const s of sales) ws3.addRow([s.sale_date, s.location, +s.net_sales||0, +s.gross_sales||0, s.covers||0, s.notes||'']);
    }

    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="CM_Payroll_${from}_to_${to}.xlsx"`,
      }
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
