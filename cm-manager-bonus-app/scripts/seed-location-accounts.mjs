import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), '.env.local'));
loadEnvFile(path.resolve(process.cwd(), '../chiangmai-payroll-app-3-12/.env.local'));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRole) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run this from cm-manager-bonus-app with server env vars available.');
  process.exit(1);
}

const accounts = [
  { location: 'All locations / Owner', email: 'owner.manager@cm-manager-bonus.app', password: 'CMBonus-All-2026!' },
  { location: 'Chiang Mai Danforth', email: 'danforth.manager@cm-manager-bonus.app', password: 'CMBonus-Danforth-2026!' },
  { location: 'Chiang Mai Junction', email: 'junction.manager@cm-manager-bonus.app', password: 'CMBonus-Junction-2026!' },
  { location: 'Chiang Mai Liberty Village', email: 'liberty.manager@cm-manager-bonus.app', password: 'CMBonus-Liberty-2026!' },
  { location: 'Chiang Mai Mississauga', email: 'mississauga.manager@cm-manager-bonus.app', password: 'CMBonus-Mississauga-2026!' },
  { location: 'Chiang Mai Parklawn', email: 'parklawn.manager@cm-manager-bonus.app', password: 'CMBonus-Parklawn-2026!' },
  { location: 'Chiang Mai York Mills', email: 'yorkmills.manager@cm-manager-bonus.app', password: 'CMBonus-YorkMills-2026!' },
  { location: 'Imm Thai Kitchen', email: 'immthai.manager@cm-manager-bonus.app', password: 'CMBonus-ImmThai-2026!' },
];

const supabase = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(email) {
  const perPage = 1000;
  for (let page = 1; page < 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find(user => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < perPage) return null;
  }
  return null;
}

for (const account of accounts) {
  const metadata = {
    app: 'cm-manager-bonus',
    role: account.location.startsWith('All locations') ? 'owner' : 'location_manager',
    location: account.location,
    seeded_by: 'seed-location-accounts',
  };
  const existing = await findUserByEmail(account.email);
  if (existing) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: account.password,
      email_confirm: true,
      app_metadata: { ...(existing.app_metadata || {}), ...metadata },
      user_metadata: { ...(existing.user_metadata || {}), location: account.location },
    });
    if (error) throw error;
    console.log(`updated,${account.location},${account.email},${account.password}`);
  } else {
    const { error } = await supabase.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
      app_metadata: metadata,
      user_metadata: { location: account.location },
    });
    if (error) throw error;
    console.log(`created,${account.location},${account.email},${account.password}`);
  }
}
