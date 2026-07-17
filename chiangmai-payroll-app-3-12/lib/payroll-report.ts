import { EmployeeRule, Punch } from './types';
import { getPayrollDate } from './payroll';
import { ontarioHolidayMapForRange } from './ontario-holidays';

const normalize=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,' ');
const round2=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
export const roundQuarterHour=(value:number)=>Math.round((value+Number.EPSILON)*4)/4;
const locationSet=(value?:string)=>new Set((value||'').split(',').map(normalize).filter(Boolean));

export type PayrollReportRow={
  employee_id:string; employee_name:string; locations:string[]; roles:string[]; location_hours:Record<string,number>; location_regular_hours:Record<string,number>; location_holiday_hours:Record<string,number>; location_holiday_pay:Record<string,number>; location_gross_hours:Record<string,number>; location_break_hours:Record<string,number>;
  wage:number; cash_wage:number; rule_type:string; rule_value:number; cheque_cap:number; gross_hours:number; break_hours:number; unpaid_break_hours:number; paid_break_hours:number;
  payable_hours:number; regular_payable_hours:number; holiday_hours:number; holiday_pay:number; rounded_hours:number; cheque_hours:number; cash_hours:number; cheque_pay:number; cash_pay:number;
  total_pay:number; status:string; notes:string; holiday_notes:string[];
};

function ruleFor(employeeId:string,name:string,rules:EmployeeRule[],periodEnd:string){
  return rules.filter(rule=>rule.active!==false
    && (!rule.employee_id||rule.employee_id===employeeId)
    && (rule.employee_id||normalize(rule.employee_name)===normalize(name))
    && (!rule.effective_from||rule.effective_from<=periodEnd)
    && (!rule.effective_to||rule.effective_to>=periodEnd))
    .sort((a,b)=>(b.effective_from||'').localeCompare(a.effective_from||''))[0];
}

function usesPerLocationDefaultCap(rule?:EmployeeRule){
  return !rule || rule.rule_type === 'NOTE_ONLY' || rule.rule_type === 'PAY_UNDER_OTHER_LOCATION';
}

function locationDefaultAllocation(
  locationRegularHours:Record<string,number>,
  wage:number,
  cashWage:number,
  cap=88,
){
  return Object.values(locationRegularHours).reduce((sum,hours)=>{
    const rounded=roundQuarterHour(Number(hours||0));
    const cheque=Math.min(rounded,cap);
    const cash=Math.max(0,rounded-cheque);
    return {
      rounded:round2(sum.rounded+rounded),
      cheque:round2(sum.cheque+cheque),
      cash:round2(sum.cash+cash),
      chequePay:round2(sum.chequePay+cheque*wage),
      cashPay:round2(sum.cashPay+cash*cashWage),
    };
  },{rounded:0,cheque:0,cash:0,chequePay:0,cashPay:0});
}

export function buildPayrollReport(punches:Punch[],rules:EmployeeRule[],periodEnd:string):PayrollReportRow[]{
  const holidayMap = ontarioHolidayMapForRange(
    punches.reduce((min,punch)=>{const date=getPayrollDate(punch.clocked_in);return date&&date<min?date:min;},periodEnd),
    periodEnd,
  );
  const grouped=new Map<string,Punch[]>();
  for(const punch of punches){
    if(!punch.clocked_out)continue;
    const key=punch.employee_id||`name:${normalize(punch.employee_name)}`;
    grouped.set(key,[...(grouped.get(key)||[]),punch]);
  }
  return [...grouped.entries()].map(([employeeId,items])=>{
    const first=items[0];const locations=new Set<string>();const roles=new Set<string>();const locationHours:Record<string,number>={};const locationRegularHours:Record<string,number>={};const locationHolidayHours:Record<string,number>={};const locationHolidayPay:Record<string,number>={};const locationGross:Record<string,number>={};const locationBreaks:Record<string,number>={};const holidayNotes=new Set<string>();
    let payable=0,regularPayable=0,holidayHours=0,holidayPay=0,gross=0,breakMinutes=0,weightedWage=0;
    for(const punch of items){
      const hours=Number(punch.payroll_hours ?? punch.hours ?? 0);const grossHours=Number(punch.gross_hours||0)||hours;
      const punchDate=getPayrollDate(punch.clocked_in);const holiday=holidayMap.get(punchDate);const isHoliday=Boolean(holiday);const punchWage=Number(punch.wage||0);
      payable+=hours;gross+=grossHours;breakMinutes+=Number(punch.break_minutes||0);weightedWage+=hours*Number(punch.wage||0);
      const location=punch.location||'Unknown';locations.add(location);locationHours[location]=(locationHours[location]||0)+hours;locationGross[location]=(locationGross[location]||0)+grossHours;locationBreaks[location]=(locationBreaks[location]||0)+Number(punch.break_minutes||0)/60;
      if(isHoliday){holidayHours+=hours;const premium=hours*punchWage*1.5;holidayPay+=premium;locationHolidayHours[location]=(locationHolidayHours[location]||0)+hours;locationHolidayPay[location]=(locationHolidayPay[location]||0)+premium;holidayNotes.add(`${holiday!.name}: ${round2(hours)}h @1.5x=${round2(premium)}`);}
      else{regularPayable+=hours;locationRegularHours[location]=(locationRegularHours[location]||0)+hours;}
      if(punch.role||punch.department)roles.add(punch.role||punch.department||'');
    }
    const combinedRounded=roundQuarterHour(regularPayable);const wage=payable>0?weightedWage/payable:Number(first.wage||0);const cashWage=Number(first.cash_wage||0)||wage;const rule=ruleFor(employeeId,first.employee_name,rules,periodEnd);
    let cap=88;let rounded=combinedRounded;let cheque=Math.min(rounded,cap),cash=Math.max(0,rounded-cheque),status=rounded>88?'Over 88 → cash':'',notes=rule?.notes||'';
    if(usesPerLocationDefaultCap(rule)){
      const locationAllocation=locationDefaultAllocation(locationRegularHours,wage,cashWage,cap);
      rounded=locationAllocation.rounded;cheque=locationAllocation.cheque;cash=locationAllocation.cash;
      status=cash>0?'Over 88 at one or more locations → cash':(rule?.rule_type==='PAY_UNDER_OTHER_LOCATION'?`Pay under ${rule.payroll_location||'other location'}`:(rule?.rule_type==='NOTE_ONLY'&&notes?'Review note':''));
    }
    if(rule?.rule_type==='CASH_ONLY'){cheque=0;cash=rounded;status='CASH (all)';}
    if(rule?.rule_type==='PARTIAL_CASH'){
      const cashLocations=locationSet(rule.combined_locations);
      const rawCash=Object.entries(locationRegularHours).reduce((sum,[location,hours])=>sum+(cashLocations.has(normalize(location))?hours:0),0);
      cash=Math.min(rounded,roundQuarterHour(rawCash));
      cheque=round2(Math.max(0,rounded-cash));
      status=cash>0?'Partial cash by location':'Partial cash rule';
    }
    if(rule?.rule_type==='HOLD_PAYROLL'){cheque=0;cash=0;status='HOLD — NO PAY';}
    if(rule?.rule_type==='PAYROLL_HOURS_CAP'||rule?.rule_type==='COMBINED_LOCATION_CAP'){
      cap=Math.max(0,Number(rule.rule_value||0));cheque=Math.min(rounded,cap);cash=Math.max(0,rounded-cheque);status=`Exception ${cap}h`;
    }
    if(rule?.rule_type==='NOTE_ONLY'&&notes)status='Review note';
    let chequePay=cheque*wage,cashPay=cash*cashWage;
    if(usesPerLocationDefaultCap(rule)){
      const locationAllocation=locationDefaultAllocation(locationRegularHours,wage,cashWage,cap);
      chequePay=locationAllocation.chequePay;cashPay=locationAllocation.cashPay;
    }
    if(rule?.rule_type==='SALARY_FIXED'){cheque=rounded;cash=0;chequePay=Number(rule.rule_value||0);cashPay=0;status='SALARY FIXED';}
    const unpaidBreak=Math.max(0,gross-payable);const totalBreak=breakMinutes/60;const paidBreak=Math.max(0,totalBreak-unpaidBreak);
    const holidayNoteText=[...holidayNotes].join('; ');
    const finalNotes=[holidayNoteText,notes].filter(Boolean).join('; ');
    return {employee_id:employeeId,employee_name:first.employee_name,locations:[...locations].sort(),roles:[...roles].filter(Boolean).sort(),
      location_hours:Object.fromEntries(Object.entries(locationHours).map(([key,value])=>[key,round2(value)])),location_regular_hours:Object.fromEntries(Object.entries(locationRegularHours).map(([key,value])=>[key,round2(value)])),location_holiday_hours:Object.fromEntries(Object.entries(locationHolidayHours).map(([key,value])=>[key,round2(value)])),location_holiday_pay:Object.fromEntries(Object.entries(locationHolidayPay).map(([key,value])=>[key,round2(value)])),location_gross_hours:Object.fromEntries(Object.entries(locationGross).map(([key,value])=>[key,round2(value)])),location_break_hours:Object.fromEntries(Object.entries(locationBreaks).map(([key,value])=>[key,round2(value)])),wage:round2(wage),cash_wage:round2(cashWage),rule_type:rule?.rule_type||'STANDARD',rule_value:Number(rule?.rule_value||0),cheque_cap:cap,gross_hours:round2(gross),break_hours:round2(totalBreak),
      unpaid_break_hours:round2(unpaidBreak),paid_break_hours:round2(paidBreak),payable_hours:round2(payable),regular_payable_hours:round2(regularPayable),holiday_hours:round2(holidayHours),holiday_pay:round2(holidayPay),rounded_hours:round2(rounded),cheque_hours:round2(cheque),cash_hours:round2(cash),
      cheque_pay:round2(chequePay),cash_pay:round2(cashPay),total_pay:round2(chequePay+cashPay+holidayPay),status,notes:finalNotes,holiday_notes:[...holidayNotes]};
  }).sort((a,b)=>a.employee_name.localeCompare(b.employee_name));
}

export function summarizePayrollReport(rows:PayrollReportRow[]){return rows.reduce((sum,row)=>({employees:sum.employees+1,gross_hours:round2(sum.gross_hours+row.gross_hours),break_hours:round2(sum.break_hours+row.break_hours),payable_hours:round2(sum.payable_hours+row.payable_hours),regular_payable_hours:round2(sum.regular_payable_hours+row.regular_payable_hours),holiday_hours:round2(sum.holiday_hours+row.holiday_hours),holiday_pay:round2(sum.holiday_pay+row.holiday_pay),rounded_hours:round2(sum.rounded_hours+row.rounded_hours),cheque_hours:round2(sum.cheque_hours+row.cheque_hours),cash_hours:round2(sum.cash_hours+row.cash_hours),cheque_pay:round2(sum.cheque_pay+row.cheque_pay),cash_pay:round2(sum.cash_pay+row.cash_pay),total_pay:round2(sum.total_pay+row.total_pay)}),{employees:0,gross_hours:0,break_hours:0,payable_hours:0,regular_payable_hours:0,holiday_hours:0,holiday_pay:0,rounded_hours:0,cheque_hours:0,cash_hours:0,cheque_pay:0,cash_pay:0,total_pay:0});}

export function payrollLocationView(row:PayrollReportRow, location:string):PayrollReportRow {
  const gross = Number(row.location_gross_hours[location] || 0);
  const breaks = Number(row.location_break_hours[location] || 0);
  const payable = Number(row.location_hours[location] || 0);
  const regularPayable = Number(row.location_regular_hours[location] || 0);
  const holidayHours = Number(row.location_holiday_hours[location] || 0);
  const holidayPay = Number(row.location_holiday_pay[location] || 0);
  const unpaidBreak = Math.max(0, gross - payable);
  const localRounded = roundQuarterHour(regularPayable);
  const perLocationDefaultCap = row.rule_type === 'STANDARD' || row.rule_type === 'NOTE_ONLY' || row.rule_type === 'PAY_UNDER_OTHER_LOCATION';
  const share = row.regular_payable_hours > 0 ? regularPayable / row.regular_payable_hours : 0;
  const chequeHours = perLocationDefaultCap ? round2(Math.min(localRounded,row.cheque_cap||88)) : round2(row.cheque_hours * share);
  const cashHours = perLocationDefaultCap ? round2(Math.max(0,localRounded-chequeHours)) : round2(row.cash_hours * share);
  const chequePay = perLocationDefaultCap ? round2(chequeHours*row.wage) : round2(row.cheque_pay * share);
  const cashPay = perLocationDefaultCap ? round2(cashHours*row.cash_wage) : round2(row.cash_pay * share);
  return {
    ...row,
    gross_hours:round2(gross),
    break_hours:round2(breaks),
    unpaid_break_hours:round2(unpaidBreak),
    paid_break_hours:round2(Math.max(0,breaks-unpaidBreak)),
    payable_hours:round2(payable),
    regular_payable_hours:round2(regularPayable),
    holiday_hours:round2(holidayHours),
    holiday_pay:round2(holidayPay),
    rounded_hours:localRounded,
    cheque_hours:chequeHours,
    cash_hours:cashHours,
    cheque_pay:chequePay,
    cash_pay:cashPay,
    total_pay:round2(chequePay+cashPay+holidayPay),
    status:`${row.status ? `${row.status} · ` : ''}Location hours`,
    notes:`Showing ${location} hours with its own ${row.cheque_cap || 88}h cheque cap${perLocationDefaultCap ? '' : ' (special employee rule allocated from the combined result)'}. ${row.notes || ''}`.trim(),
  };
}
