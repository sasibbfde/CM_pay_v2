export type SevenShiftLike = Record<string, any>;

const round2 = (value:number) => Math.round(Math.max(0,value) * 100) / 100;
export const scheduleNameKey = (value?:string|null) => (value || '').toLowerCase().replace(/[^a-z0-9]/g,'');

export function scheduledHours(start?:string|null,end?:string|null) {
  if (!start || !end) return 0;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  return round2((endMs - startMs) / 3_600_000);
}

export function firstValue(...values:any[]) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

export function normalizeShiftTime(shift:SevenShiftLike,kind:'start'|'end') {
  return firstValue(
    shift[`${kind}`],
    shift[`${kind}_time`],
    shift[`${kind}_date_time`],
    shift[`${kind}_datetime`],
    shift[`scheduled_${kind}`],
    shift[`clocked_${kind === 'start' ? 'in' : 'out'}`],
  ) || null;
}

export function normalizeShiftId(shift:SevenShiftLike,index:number) {
  const id = firstValue(shift.id,shift.shift_id,shift.uuid);
  if (id) return String(id);
  return [
    firstValue(shift.user_id,shift.employee_id,'unknown'),
    normalizeShiftTime(shift,'start') || '',
    normalizeShiftTime(shift,'end') || '',
    firstValue(shift.location_id,shift.location?.id,'unknown'),
    index,
  ].join('|').replace(/[^a-zA-Z0-9|._:-]/g,'');
}
