# Chiang Mai Payroll App

Next.js + Supabase payroll dashboard for Chiang Mai Group.

## Features
- Period dashboard: 1-15, 16-end, full month
- Monthly dashboard
- Yearly totals
- Employee rule engine
- Cash/cheque split
- Multi-location hour caps
- Salary/fixed-pay rules
- Payroll audit table
- 7shifts sync placeholder
- Vercel deployment ready

## Environment variables
Add these in Vercel Project Settings → Environment Variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SEVENSHIFTS_API_KEY=
SEVENSHIFTS_COMPANY_ID=
```

Do not put real keys in GitHub.

## Supabase setup
1. Create a Supabase project.
2. Open SQL Editor.
3. Run `supabase/schema.sql`.
4. Optional: run `supabase/seed.sql` to load demo employees/rules/punches.
5. Copy project keys into Vercel.

## Local development
```bash
npm install
npm run dev
```

Open http://localhost:3000

## Vercel deployment
1. Upload this folder to GitHub.
2. Import the repository in Vercel.
3. Add environment variables.
4. Deploy.

## 7shifts token
Leave `SEVENSHIFTS_API_KEY` empty until the app deploys successfully. Add it only in Vercel environment variables, never in code or GitHub.
