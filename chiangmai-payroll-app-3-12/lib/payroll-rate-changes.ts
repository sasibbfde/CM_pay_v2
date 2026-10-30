// Explicit effective dates for saved rates. Other wage history remains an
// audit ledger and does not change the existing saved-rate behavior.
export type PayrollRateChange = {
  employee_id: string;
  old_wage: number;
  new_wage: number;
  effective_date: string;
  detected_at: string;
  metadata?: { old_role?: string; new_role?: string };
};

export async function loadPayrollRateChanges(supabase: any): Promise<PayrollRateChange[]> {
  const rows: PayrollRateChange[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('employee_wage_history')
      .select('employee_id,old_wage,new_wage,effective_date,detected_at,metadata')
      .eq('source', 'manual')
      .contains('metadata', { payroll_effective_date: true })
      .order('effective_date')
      .order('detected_at')
      .order('id')
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

export function savedRateForDate(currentWage: number, date: string, changes: PayrollRateChange[]) {
  // Each explicitly dated change snapshots the saved rate it replaced. Before
  // that date use the snapshot; after the latest change keep normal current
  // rate behavior, including subsequent edits and higher 7shifts rates.
  const next = changes.find(change => change.effective_date > date);
  return next ? Number(next.old_wage) : currentWage;
}

export function savedRoleForDate(currentRole: string | undefined, date: string, changes: PayrollRateChange[]) {
  return changes.filter(change => change.effective_date <= date && change.metadata?.new_role)
    .sort((a,b) => a.effective_date.localeCompare(b.effective_date) || a.detected_at.localeCompare(b.detected_at))
    .at(-1)?.metadata?.new_role || currentRole;
}
