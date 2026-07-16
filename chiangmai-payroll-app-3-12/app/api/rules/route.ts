import { NextRequest, NextResponse } from 'next/server';
import { mockRules } from '@/lib/mock-data';
import { getSupabaseAdmin, hasSupabaseEnv } from '@/lib/supabase';
import type { EmployeeRule, RuleType } from '@/lib/types';

const RULE_TYPES: RuleType[] = [
  'CASH_ONLY',
  'PARTIAL_CASH',
  'PAYROLL_HOURS_CAP',
  'COMBINED_LOCATION_CAP',
  'SALARY_FIXED',
  'HOLD_PAYROLL',
  'PAY_UNDER_OTHER_LOCATION',
  'NOTE_ONLY',
];

function cleanRule(input: Partial<EmployeeRule>) {
  const employeeName = String(input.employee_name || '').trim();
  const ruleType = String(input.rule_type || '').trim() as RuleType;
  if (!employeeName) throw new Error('Employee name is required');
  if (!RULE_TYPES.includes(ruleType)) throw new Error('Valid rule type is required');

  const ruleValue =
    input.rule_value === '' || input.rule_value === undefined || input.rule_value === null
      ? null
      : Number(input.rule_value);
  if (ruleValue !== null && !Number.isFinite(ruleValue)) throw new Error('Rule value must be a number');

  return {
    ...(input.id ? { id: input.id } : {}),
    ...(input.employee_id ? { employee_id: input.employee_id } : {}),
    employee_name: employeeName,
    rule_type: ruleType,
    rule_value: ruleValue,
    combined_locations: String(input.combined_locations || '').trim() || null,
    payroll_location: String(input.payroll_location || '').trim() || null,
    notes: String(input.notes || '').trim() || null,
    active: input.active ?? true,
    effective_from: input.effective_from || null,
    effective_to: input.effective_to || null,
  };
}

export async function GET(req: NextRequest) {
  if (!hasSupabaseEnv()) return NextResponse.json({ source: 'mock', rules: mockRules });
  try {
    const showAll = req.nextUrl.searchParams.get('active') === 'all';
    const supabase = getSupabaseAdmin();
    let query = supabase.from('employee_rules').select('*').order('employee_name');
    if (!showAll) query = query.eq('active', true);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ source: 'supabase', rules: data?.length ? data : mockRules });
  } catch (error: any) {
    return NextResponse.json({ source: 'mock - supabase not connected', rules: mockRules, error: error.message }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rules = Array.isArray(body) ? body.map(cleanRule) : cleanRule(body);
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('employee_rules').upsert(rules).select();
    if (error) throw error;
    return NextResponse.json({ ok: true, rules: data });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.id) throw new Error('Rule id is required');
    const rule = cleanRule(body);
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('employee_rules').update(rule).eq('id', body.id).select();
    if (error) throw error;
    return NextResponse.json({ ok: true, rules: data });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    let id = req.nextUrl.searchParams.get('id');
    if (!id) {
      try {
        const body = await req.json();
        id = body?.id || null;
      } catch {}
    }
    if (!id) throw new Error('Rule id is required');
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('employee_rules').update({ active: false }).eq('id', id).select();
    if (error) throw error;
    return NextResponse.json({ ok: true, rules: data });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
