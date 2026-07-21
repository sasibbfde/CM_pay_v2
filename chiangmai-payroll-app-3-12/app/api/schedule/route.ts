import { NextRequest, NextResponse } from 'next/server';
import { fetchDepartments, fetchRoles, fetchShifts, fetchUsers } from '@/lib/7shifts';
import { getSupabaseAdmin } from '@/lib/supabase';
import { firstValue, normalizeShiftId, normalizeShiftTime, scheduledHours, scheduleNameKey } from '@/lib/schedule';

export const maxDuration = 120;

const LOCATION_MAP: Record<string, string> = {
  '450889': 'Chiang Mai Liberty Village',
  '458858': 'Chiang Mai York Mills',
  '461096': 'Chiang Mai Junction',
  '461097': 'Chiang Mai Danforth',
  '464811': 'Imm Thai Kitchen',
  '465654': 'Chiang Mai Parklawn',
  '500371': 'Chiang Mai Mississauga',
  '467000': 'Chiang Mai Mississauga',
};

function fullName(user:any) {
  return [user?.first_name,user?.last_name].map(value=>(value || '').trim()).filter(Boolean).join(' ') || `Staff ${user?.id || ''}`.trim();
}

function normalizeLocation(locationId:any, rawName?:string|null) {
  const mapped = LOCATION_MAP[String(locationId || '')];
  if (mapped) return mapped;
  const raw = (rawName || '').trim();
  if (!raw) return 'Unknown';
  const compact = raw.toLowerCase().replace(/[^a-z0-9]/g,'');
  if (compact.includes('immthai')) return 'Imm Thai Kitchen';
  if (compact.includes('mississauga')) return 'Chiang Mai Mississauga';
  if (compact.includes('yorkmills') || compact.includes('yorkmill')) return 'Chiang Mai York Mills';
  if (compact.includes('liberty')) return 'Chiang Mai Liberty Village';
  if (compact.includes('junction')) return 'Chiang Mai Junction';
  if (compact.includes('danforth')) return 'Chiang Mai Danforth';
  if (compact.includes('parklawn')) return 'Chiang Mai Parklawn';
  return raw;
}

async function fetchAllDb(supabase:any,table:string,columns:string,filter?:(query:any)=>any) {
  const rows:any[] = [];
  for (let from=0;;from+=1000) {
    let query = supabase.from(table).select(columns).range(from,from+999);
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function dateBounds(start:string,end:string) {
  return {
    startIso:`${start}T00:00:00.000Z`,
    endIso:`${end}T23:59:59.999Z`,
  };
}

function validDate(value:string|null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function GET(req:NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const start = sp.get('start');
    const end = sp.get('end');
    if (!validDate(start) || !validDate(end)) return NextResponse.json({ error:'Valid start and end dates are required', shifts:[] }, { status:400 });
    const { startIso, endIso } = dateBounds(start!,end!);
    const supabase = getSupabaseAdmin();
    const shifts = await fetchAllDb(supabase,'scheduled_shifts','*',query=>query.gte('start_at',startIso).lte('start_at',endIso).order('start_at'));
    return NextResponse.json({ shifts, start, end });
  } catch (error:any) {
    return NextResponse.json({ shifts:[], error:error.message }, { status:500 });
  }
}

export async function POST(req:NextRequest) {
  try {
    const body = await req.json().catch(()=>({}));
    const start = String(body.start || '').slice(0,10);
    const end = String(body.end || '').slice(0,10);
    if (!validDate(start) || !validDate(end)) return NextResponse.json({ ok:false, error:'Valid start and end dates are required' }, { status:400 });

    const supabase = getSupabaseAdmin();
    const [usersRes,deptRes,roleRes,existingEmployees,shiftRes] = await Promise.all([
      fetchUsers(),
      fetchDepartments(),
      fetchRoles(),
      fetchAllDb(supabase,'employees','employee_id,seven_shifts_user_id,full_name,location,department,role,active'),
      fetchShifts(start,end),
    ]);

    const users = new Map<string,any>((usersRes.data || []).map((user:any)=>[String(user.id),user]));
    const departments = new Map<string,string>((deptRes.data || []).map((dept:any)=>[String(dept.id),dept.name || '']));
    const roles = new Map<string,string>((roleRes.data || []).map((role:any)=>[String(role.id),role.name || '']));
    const employeesBy7s = new Map<string,any>();
    const employeesByName = new Map<string,any>();
    for (const employee of existingEmployees || []) {
      if (employee.seven_shifts_user_id) employeesBy7s.set(String(employee.seven_shifts_user_id), employee);
      if (employee.full_name) employeesByName.set(scheduleNameKey(employee.full_name), employee);
    }

    const rows = (shiftRes.data || []).map((shift:any,index:number) => {
      const userId = String(firstValue(shift.user_id,shift.user?.id,shift.employee_id,shift.employee?.id,''));
      const user = userId ? users.get(userId) : undefined;
      const employeeName = firstValue(shift.employee_name,shift.user?.name,shift.employee?.name,user ? fullName(user) : '',`Staff ${userId || index+1}`);
      const employee = (userId ? employeesBy7s.get(userId) : undefined) || employeesByName.get(scheduleNameKey(employeeName));
      const startAt = normalizeShiftTime(shift,'start');
      const endAt = normalizeShiftTime(shift,'end');
      const locationId = firstValue(shift.location_id,shift.location?.id,user?.location_id,employee?.location_id);
      const location = normalizeLocation(locationId, firstValue(shift.location_name,shift.location?.name,employee?.location));
      const department = firstValue(shift.department_name,shift.department?.name,departments.get(String(firstValue(shift.department_id,shift.department?.id,user?.department_id,''))),employee?.department,'');
      const role = firstValue(shift.role_name,shift.role?.name,roles.get(String(firstValue(shift.role_id,shift.role?.id,user?.role_id,''))),employee?.role,'');
      return {
        shift_id:`7S-SHIFT-${normalizeShiftId(shift,index)}`,
        employee_id:employee?.employee_id || (userId ? `7S-${userId}` : null),
        seven_shifts_user_id:userId || employee?.seven_shifts_user_id || null,
        employee_name:employee?.full_name || employeeName,
        location,
        department,
        role,
        start_at:startAt,
        end_at:endAt,
        scheduled_hours:scheduledHours(startAt,endAt),
        status:firstValue(shift.status,shift.approval_status,shift.published ? 'published' : ''),
        source:'7shifts',
        raw:shift,
        updated_at:new Date().toISOString(),
      };
    }).filter((row:any)=>row.start_at && row.end_at && row.scheduled_hours > 0);

    const { startIso, endIso } = dateBounds(start,end);
    const existing = await fetchAllDb(supabase,'scheduled_shifts','id',query=>query.gte('start_at',startIso).lte('start_at',endIso));
    for (let index=0; index<existing.length; index+=200) {
      const { error } = await supabase.from('scheduled_shifts').delete().in('id', existing.slice(index,index+200).map(row=>row.id));
      if (error) throw error;
    }
    for (let index=0; index<rows.length; index+=200) {
      const { error } = await supabase.from('scheduled_shifts').upsert(rows.slice(index,index+200), { onConflict:'shift_id' });
      if (error) throw error;
    }

    return NextResponse.json({ ok:true, synced:rows.length, start, end });
  } catch (error:any) {
    return NextResponse.json({ ok:false, error:error.message }, { status:500 });
  }
}
