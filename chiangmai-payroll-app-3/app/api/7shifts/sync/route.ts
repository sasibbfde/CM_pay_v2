import { NextResponse } from 'next/server';
import { fetchTimePunches, fetchUsers } from '@/lib/7shifts';
import { getSupabaseAdmin } from '@/lib/supabase';

function fullName(u: any) {
  return `${u.first_name || ''} ${u.last_name || ''}`.trim();
}

export async function GET() {
  return POST(
    new Request('https://local-sync', {
      method: 'POST',
      body: JSON.stringify({})
    })
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const start =
      body.start ||
      new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

    const end = body.end || new Date().toISOString();

    const supabase = getSupabaseAdmin();

    const users = await fetchUsers();

    const userRows = (users?.data || users || []).map((u: any) => ({
      employee_id: `7S-${u.id}`,
      seven_shifts_user_id: String(u.id),
      first_name: u.first_name || '',
      last_name: u.last_name || '',
      full_name: fullName(u),
      location: null,
      department: null,
      role: u.type || null,
      wage: Number(u.hourly_wage || 0),
      active: Boolean(u.active),
      source: '7shifts'
    }));

    const { error: userError } = await supabase
      .from('employees')
      .upsert(userRows, { onConflict: 'seven_shifts_user_id' });

    if (userError) throw userError;

    let punchesSaved = 0;
    let punchErrorMessage = null;

    try {
      const punches = await fetchTimePunches(start, end);
      const punchList = punches?.data || punches || [];

      const punchRows = punchList.map((p: any) => {
        const userId = p.user_id || p.employee_id || p.user?.id;
        const matchedUser = (users?.data || users || []).find(
          (u: any) => String(u.id) === String(userId)
        );

        const employeeName =
          p.employee_name ||
          p.user_name ||
          (matchedUser ? fullName(matchedUser) : `User ${userId}`);

        return {
          punch_id: String(p.id || p.punch_id),
          employee_id: userId ? `7S-${userId}` : null,
          employee_name: employeeName,
          location: p.location_name || p.location || null,
          department: p.department_name || p.department || null,
          role: p.role_name || p.role || null,
          clocked_in: p.clocked_in || p.start || p.start_time || p.clock_in,
          clocked_out: p.clocked_out || p.end || p.end_time || p.clock_out,
          hours: Number(p.hours || p.total_hours || 0),
          wage: Number(p.hourly_wage || p.wage || matchedUser?.hourly_wage || 0),
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
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function GET() {
  return POST(
    new Request('https://local-sync', {
      method: 'POST',
      body: JSON.stringify({})
    })
  );
}
