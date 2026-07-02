import { EmployeeRule, Punch } from './types';

const normalize=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,' ');
const round2=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
export const roundQuarterHour=(value:number)=>Math.round((value+Number.EPSILON)*4)/4;

export type PayrollReportRow={
  employee_id:string; employee_name:string; locations:string[]; roles:string[]; location_hours:Record<string,number>; location_gross_hours:Record<string,number>; location_break_hours:Record<string,number>;
  wage:number; cash_wage:number; rule_type:string; rule_value:number; cheque_cap:number; gross_hours:number; break_hours:number; unpaid_break_hours:number; paid_break_hours:number;
  payable_hours:number; rounded_hours:number; cheque_hours:number; cash_hours:number; cheque_pay:number; cash_pay:number;
  total_pay:number; status:string; notes:string;
};

function ruleFor(employeeId:string,name:string,rules:EmployeeRule[],periodEnd:string){
  return rules.filter(rule=>rule.active!==false
    && (!rule.employee_id||rule.employee_id===employeeId)
    && (rule.employee_id||normalize(rule.employee_name)===normalize(name))
    && (!rule.effective_from||rule.effective_from<=periodEnd)
    && (!rule.effective_to||rule.effective_to>=periodEnd))
    .sort((a,b)=>(b.effective_from||'').localeCompare(a.effective_from||''))[0];
}

export function buildPayrollReport(punches:Punch[],rules:EmployeeRule[],periodEnd:string):PayrollReportRow[]{
  const grouped=new Map<string,Punch[]>();
  for(const punch of punches){
    if(!punch.clocked_out)continue;
    const key=punch.employee_id||`name:${normalize(punch.employee_name)}`;
    grouped.set(key,[...(grouped.get(key)||[]),punch]);
  }
  return [...grouped.entries()].map(([employeeId,items])=>{
    const first=items[0];const locations=new Set<string>();const roles=new Set<string>();const locationHours:Record<string,number>={};const locationGross:Record<string,number>={};const locationBreaks:Record<string,number>={};
    let payable=0,gross=0,breakMinutes=0,weightedWage=0;
    for(const punch of items){
      const hours=Number(punch.payroll_hours ?? punch.hours ?? 0);const grossHours=Number(punch.gross_hours||0)||hours;
      payable+=hours;gross+=grossHours;breakMinutes+=Number(punch.break_minutes||0);weightedWage+=hours*Number(punch.wage||0);
      const location=punch.location||'Unknown';locations.add(location);locationHours[location]=(locationHours[location]||0)+hours;locationGross[location]=(locationGross[location]||0)+grossHours;locationBreaks[location]=(locationBreaks[location]||0)+Number(punch.break_minutes||0)/60;
      if(punch.role||punch.department)roles.add(punch.role||punch.department||'');
    }
    const rounded=roundQuarterHour(payable);const wage=payable>0?weightedWage/payable:Number(first.wage||0);const rule=ruleFor(employeeId,first.employee_name,rules,periodEnd);
    let cap=88;let cheque=Math.min(rounded,cap),cash=Math.max(0,rounded-cheque),status=rounded>88?'Over 88 → cash':'',notes=rule?.notes||'';
    if(rule?.rule_type==='CASH_ONLY'){cheque=0;cash=rounded;status='CASH (all)';}
    if(rule?.rule_type==='HOLD_PAYROLL'){cheque=0;cash=0;status='HOLD — NO PAY';}
    if(rule?.rule_type==='PAYROLL_HOURS_CAP'||rule?.rule_type==='COMBINED_LOCATION_CAP'){
      cap=Math.max(0,Number(rule.rule_value||0));cheque=Math.min(rounded,cap);cash=Math.max(0,rounded-cheque);status=`Exception ${cap}h`;
    }
    if(rule?.rule_type==='PAY_UNDER_OTHER_LOCATION')status=`Pay under ${rule.payroll_location||'other location'}`;
    if(rule?.rule_type==='NOTE_ONLY'&&notes)status='Review note';
    let chequePay=cheque*wage,cashPay=cash*(Number(first.cash_wage||0)||wage);
    if(rule?.rule_type==='SALARY_FIXED'){cheque=rounded;cash=0;chequePay=Number(rule.rule_value||0);cashPay=0;status='SALARY FIXED';}
    const unpaidBreak=Math.max(0,gross-payable);const totalBreak=breakMinutes/60;const paidBreak=Math.max(0,totalBreak-unpaidBreak);
    return {employee_id:employeeId,employee_name:first.employee_name,locations:[...locations].sort(),roles:[...roles].filter(Boolean).sort(),
      location_hours:Object.fromEntries(Object.entries(locationHours).map(([key,value])=>[key,round2(value)])),location_gross_hours:Object.fromEntries(Object.entries(locationGross).map(([key,value])=>[key,round2(value)])),location_break_hours:Object.fromEntries(Object.entries(locationBreaks).map(([key,value])=>[key,round2(value)])),wage:round2(wage),cash_wage:round2(Number(first.cash_wage||0)||wage),rule_type:rule?.rule_type||'STANDARD',rule_value:Number(rule?.rule_value||0),cheque_cap:cap,gross_hours:round2(gross),break_hours:round2(totalBreak),
      unpaid_break_hours:round2(unpaidBreak),paid_break_hours:round2(paidBreak),payable_hours:round2(payable),rounded_hours:round2(rounded),cheque_hours:round2(cheque),cash_hours:round2(cash),
      cheque_pay:round2(chequePay),cash_pay:round2(cashPay),total_pay:round2(chequePay+cashPay),status,notes};
  }).sort((a,b)=>a.employee_name.localeCompare(b.employee_name));
}

export function summarizePayrollReport(rows:PayrollReportRow[]){return rows.reduce((sum,row)=>({employees:sum.employees+1,gross_hours:round2(sum.gross_hours+row.gross_hours),break_hours:round2(sum.break_hours+row.break_hours),payable_hours:round2(sum.payable_hours+row.payable_hours),rounded_hours:round2(sum.rounded_hours+row.rounded_hours),cheque_hours:round2(sum.cheque_hours+row.cheque_hours),cash_hours:round2(sum.cash_hours+row.cash_hours),cheque_pay:round2(sum.cheque_pay+row.cheque_pay),cash_pay:round2(sum.cash_pay+row.cash_pay),total_pay:round2(sum.total_pay+row.total_pay)}),{employees:0,gross_hours:0,break_hours:0,payable_hours:0,rounded_hours:0,cheque_hours:0,cash_hours:0,cheque_pay:0,cash_pay:0,total_pay:0});}

export function payrollLocationView(row:PayrollReportRow, location:string):PayrollReportRow {
  const gross = Number(row.location_gross_hours[location] || 0);
  const breaks = Number(row.location_break_hours[location] || 0);
  const payable = Number(row.location_hours[location] || 0);
  const unpaidBreak = Math.max(0, gross - payable);
  return {
    ...row,
    gross_hours:round2(gross),
    break_hours:round2(breaks),
    unpaid_break_hours:round2(unpaidBreak),
    paid_break_hours:round2(Math.max(0,breaks-unpaidBreak)),
    payable_hours:round2(payable),
    rounded_hours:roundQuarterHour(payable),
    status:`${row.status ? `${row.status} · ` : ''}Location hours`,
    notes:`Showing ${location} hours only. Cheque/cash allocation remains the combined all-location payroll result. ${row.notes || ''}`.trim(),
  };
}
