import { NextRequest,NextResponse } from 'next/server';
import { getPayrollReport } from '@/lib/payroll-report-data';
const valid=(value:string|null)=>Boolean(value&&/^\d{4}-\d{2}-\d{2}$/.test(value));
export async function GET(request:NextRequest){const start=request.nextUrl.searchParams.get('start');const end=request.nextUrl.searchParams.get('end');if(!valid(start)||!valid(end)||start!>end!)return NextResponse.json({error:'Valid start and end dates are required'},{status:400});try{return NextResponse.json(await getPayrollReport(start!,end!));}catch(error:any){return NextResponse.json({error:error.message},{status:500});}}
