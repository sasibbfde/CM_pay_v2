export const WAGE_CHANGE_LABEL_7SHIFTS = '7SHIFTS WAGE ↑';
export const WAGE_CHANGE_LABEL_MANUAL = 'MANUAL WAGE';
export const WAGE_CHANGE_LABEL_LEGACY = 'WAGE ↑';

export type WageChangeSource = '7shifts' | 'manual' | null;

export function wageChangeSourceForAuditAction(action?: string | null): WageChangeSource {
  if (action === 'wage_upgraded_from_7shifts') return '7shifts';
  if (action === 'manual_wage_changed') return 'manual';
  return null;
}

export function wageChangeLabelForSource(source: WageChangeSource) {
  if (source === '7shifts') return WAGE_CHANGE_LABEL_7SHIFTS;
  if (source === 'manual') return WAGE_CHANGE_LABEL_MANUAL;
  return null;
}

export function wageChangeLabelForAuditAction(action?: string | null) {
  return wageChangeLabelForSource(wageChangeSourceForAuditAction(action));
}

export function isWageChangeLabel(label: string) {
  return label === WAGE_CHANGE_LABEL_7SHIFTS
    || label === WAGE_CHANGE_LABEL_MANUAL
    || label === WAGE_CHANGE_LABEL_LEGACY;
}

export function wageChangeSourceText(source: WageChangeSource) {
  if (source === '7shifts') return '7shifts wage change';
  if (source === 'manual') return 'Manual wage change';
  return '';
}
