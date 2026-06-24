import { NextResponse } from 'next/server';
import { fetchTimePunches, fetchUsers } from '@/lib/7shifts';
import { getSupabaseAdmin } from '@/lib/supabase';

const locationMap: Record<string, string> = {
  '450889': 'Chiang Mai Liberty',
  '458858': 'Chiang Mai York Mills',
  '461096': 'Chiang Mai Junction',
  '461097': 'Chiang Mai Danforth',
  '464811': 'Imm Thai Kitchen',
  '465654': 'Chiang Mai Parklawn'
};

function fullName(u: any) {
  return `${u.first_name || ''} ${u.last_name || ''}`.trim();
}

function mapLocation(v: any) {
  return locationMap[String(v)] || String(v || 'Unknown');
}

function normalizeWage(v: any) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  return n > 100 ? n / 100 : n;
}

export async function GET() {
  return sync7shifts({});
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return sync7shifts(body);
}

async function sync7shifts(body: any) {
  try {
    const start =
      body.start ||
      new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

    const end = body.end || new Date().toISOString();

    const supabase = getSupabaseAdmin();

    const users = await fetchUsers();
    const userList = users?.data || users || [];

    const userRows = userList.map((u: any) => ({
      employee_id: `7S-${u.id}`,
      seven_shifts_user_id: String(u.id),
      first_name: u.first_name || '',
      last_name: u.last_name || '',
      full_name: fullName(u),
      location: 'Unknown',
      department: 'Unknown',
      role: u.type || 'Unknown',
      wage: normalizeWage(u.hourly_wage),
      active: Boolean(u.active),
      source: '7shifts'
    }));

    if (userRows.length) {
      const { error: userError } = await supabase
        .from('employees')
        .upsert(userRows, { onConflict: 'seven_shifts_user_id' });

      if (userError) throw userError;
    }

    let punchesSaved = 0;
    let punchErrorMessage = null;

    try {
      const punches = await fetchTimePunches(start, end);
      const punchList = punches?.data || punches || [];

      const punchRows = punchList.map((p: any) => {
        const userId = p.user_id || p.employee_id || p.user?.id;

        const matchedUser = userList.find(
          (u: any) => String(u.id) === String(userId)
        );

        const employeeName =
          p.employee_name ||
          p.user_name ||
          (matchedUser ? fullName(matchedUser) : `User ${userId || 'Unknown'}`);

        const rawWage =
          p.hourly_wage ||
          p.wage ||
          matchedUser?.hourly_wage ||
          0;

        return {
          punch_id: String(
            p.id || p.punch_id || `${userId}-${p.clocked_in || p.start}`
          ),
          employee_id: userId ? `7S-${userId}` : 'UNKNOWN',
          employee_name: employeeName,

          location: mapLocation(
            p.location_name ||
              p.location ||
              p.location_id ||
              p.locationId
          ),

          department: String(
            p.department_name ||
              p.department ||
              p.department_id ||
              p.departmentId ||
              'Unknown'
          ),

          role: String(
            p.role_name ||
              p.role ||
              p.role_id ||
              p.roleId ||
              'Unknown'
          ),

          clocked_in:
            p.clocked_in ||
            p.clock_in ||
            p.start ||
            p.start_time ||
            p.punch_in ||
            null,

          clocked_out:
            p.clocked_out ||
            p.clock_out ||
            p.end ||
            p.end_time ||
            p.punch_out ||
            null,

          hours: Number(p.hours || p.total_hours || p.duration_hours || 0),
          wage: normalizeWage(rawWage),
          source: '7shifts'
        };
      });

      if (punchRows.length) {
        const { error: punchError } = await supabase
          .from('punches')
          .upsert(punchRows, { onConflict: 'punch_id' });

        if (punchError) throw punchError;
      }

      punchesSaved = punchRows.length;
    } catch (e: any) {
      punchErrorMessage = e.message;
    }

    return NextResponse.json({
      ok: true,
      source: '7shifts',
      synced: {
        users: userRows.length,
        punches: punchesSaved
      },
      start,
      end,
      punch_error: punchErrorMessage
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}
