import {PayrollRow,Punch,EmployeeRule} from './types';
const norm=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ');
export function getPeriodRange(year:number,month:number,period:string){
  const startMonth=month-1; const endDay=new Date(year,month,0).getDate();
  if(period==='1-15') return {start:new Date(year,startMonth,1),end:new Date(year,startMonth,15,23,59,59)};
  if(period==='16-end') return {start:new Date(year,startMonth,16),end:new Date(year,startMonth,endDay,23,59,59)};
  return {start:new Date(year,startMonth,1),end:new Date(year,startMonth,endDay,23,59,59)};
}
export function filterPunches(punches:Punch[],year:number,month:number,period:string){
 const {start,end}=getPeriodRange(year,month,period);
 return punches.filter(p=>{const d=new Date(p.clocked_in); return d>=start&&d<=end});
}
export function calculatePayroll(punches:Punch[],rules:EmployeeRule[]):PayrollRow[]{
 const grouped=new Map<string,Punch[]>();
 for(const p of punches){const key=norm(p.employee_name); grouped.set(key,[...(grouped.get(key)||[]),p]);}
 const rulesByName=new Map(rules.filter(r=>r.active!==false).map(r=>[norm(r.employee_name),r]));
 const rows:PayrollRow[]=[];
 for(const [key,items] of grouped){
   const first=items[0]; const actual=items.reduce((s,p)=>s+Number(p.hours||0),0); const wage=first.wage||0; const rule=rulesByName.get(key);
   let payrollHours=actual, cashHours=0, payrollAmount=actual*wage, cashAmount=0, ruleApplied='STANDARD', notes='';
   if(rule){ notes=rule.notes||''; ruleApplied=rule.rule_type;
     if(rule.rule_type==='CASH_ONLY'){payrollHours=0;cashHours=actual;payrollAmount=0;cashAmount=actual*wage;}
     if(rule.rule_type==='PAYROLL_HOURS_CAP'||rule.rule_type==='COMBINED_LOCATION_CAP'){const cap=Number(rule.rule_value||0); payrollHours=Math.min(actual,cap); cashHours=Math.max(actual-cap,0); payrollAmount=payrollHours*wage; cashAmount=cashHours*wage;}
     if(rule.rule_type==='SALARY_FIXED'){payrollHours=actual;cashHours=0;payrollAmount=Number(rule.rule_value||0);cashAmount=0;}
     if(rule.rule_type==='HOLD_PAYROLL'){payrollHours=0;cashHours=0;payrollAmount=0;cashAmount=0;}
   }
   rows.push({employee_name:first.employee_name,location:first.location,department:first.department,role:first.role,actual_hours:round(actual),payroll_hours:round(payrollHours),cash_hours:round(cashHours),wage, payroll_amount:round(payrollAmount),cash_amount:round(cashAmount),rule_applied:ruleApplied,notes});
 }
 return rows.sort((a,b)=>a.employee_name.localeCompare(b.employee_name));
}
export function summarize(rows:PayrollRow[]){
 return {employees:rows.length,totalHours:round(rows.reduce((s,r)=>s+r.actual_hours,0)),payrollHours:round(rows.reduce((s,r)=>s+r.payroll_hours,0)),cashHours:round(rows.reduce((s,r)=>s+r.cash_hours,0)),payrollAmount:round(rows.reduce((s,r)=>s+r.payroll_amount,0)),cashAmount:round(rows.reduce((s,r)=>s+r.cash_amount,0)),exceptions:rows.filter(r=>r.rule_applied!=='STANDARD').length};
}
function round(n:number){return Math.round((n+Number.EPSILON)*100)/100}
