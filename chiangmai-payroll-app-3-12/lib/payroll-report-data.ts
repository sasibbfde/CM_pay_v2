import 'server-only';
import { getSupabaseAdmin } from './supabase';
import { applyEmployeeWages, filterPunchesByDateRange } from './payroll';
import { buildPayrollReport, summarizePayrollReport } from './payroll-report';
import { fillMissingRosterDetails } from './roster-details';
import { Employee, EmployeeRule, Punch } from './types';

async function fetchAll(supabase:any,table:string,columns:string,filter?:(query:any)=>any){
  const rows:any[]=[];for(let from=0;;from+=1000){let query=supabase.from(table).select(columns).range(from,from+999);if(filter)query=filter(query);const{data,error}=await query;if(error)throw error;rows.push(...(data||[]));if(!data||data.length<1000)break;}return rows;
}
const number=(value:any)=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:0;};

export async function getPayrollReport(start:string,end:string){
  const supabase=getSupabaseAdmin();const queryStart=new Date(`${start}T00:00:00Z`);queryStart.setUTCDate(queryStart.getUTCDate()-1);const queryEnd=new Date(`${end}T23:59:59Z`);queryEnd.setUTCDate(queryEnd.getUTCDate()+1);
  const [rawPunches,rawEmployees,rawRules]=await Promise.all([
    fetchAll(supabase,'punches','punch_id,employee_id,seven_shifts_user_id,employee_name,location,department,role,clocked_in,clocked_out,hours,payroll_hours,gross_hours,break_minutes,wage,cash_wage,source',query=>query.gte('clocked_in',queryStart.toISOString()).lte('clocked_in',queryEnd.toISOString()).order('clocked_in')),
    fetchAll(supabase,'employees','id,employee_id,seven_shifts_user_id,first_name,last_name,full_name,location,department,role,wage,cash_wage,active',query=>query.eq('active',true)),
    fetchAll(supabase,'employee_rules','id,employee_id,employee_name,rule_type,rule_value,combined_locations,payroll_location,notes,active,effective_from,effective_to',query=>query.eq('active',true)),
  ]);
  const employees=rawEmployees.map(fillMissingRosterDetails) as Employee[];
  const punches=filterPunchesByDateRange(rawPunches.map((row:any):Punch=>({...row,hours:number(row.hours),payroll_hours:number(row.payroll_hours??row.hours),gross_hours:number(row.gross_hours),break_minutes:number(row.break_minutes),wage:number(row.wage),cash_wage:number(row.cash_wage)})),start,end);
  const weighted=applyEmployeeWages(punches,employees);
  const rules=rawRules.map((row:any):EmployeeRule=>({...row,active:row.active!==false}));
  const rows=buildPayrollReport(weighted,rules,end);return{rows,summary:summarizePayrollReport(rows),start,end};
}

