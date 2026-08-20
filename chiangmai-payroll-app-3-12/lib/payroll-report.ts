import { EmployeeRule, Punch } from './types';
import { getPayrollDate } from './payroll';
import { ontarioHolidayMapForRange } from './ontario-holidays';
import { type WageChangeSource } from './payroll-change-labels';

const normalize=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,' ');
const round2=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
export const roundQuarterHour=(value:number)=>Math.round((value+Number.EPSILON)*4)/4;
const locationSet=(value?:string)=>new Set((value||'').split(',').map(normalize).filter(Boolean));

export type PayrollReportRow={
  employee_id:string; employee_name:string; locations:string[]; roles:string[]; location_hours:Record<string,number>; location_regular_hours:Record<string,number>; location_holiday_hours:Record<string,number>; location_holiday_pay:Record<string,number>; location_gross_hours:Record<string,number>; location_break_hours:Record<string,number>;
  wage:number; cash_wage:number; rule_type:string; rule_value:number; cheque_cap:number; gross_hours:number; break_hours:number; unpaid_break_hours:number; paid_break_hours:number;
  payable_hours:number; regular_payable_hours:number; holiday_hours:number; holiday_pay:number; rounded_hours:number; cheque_hours:number; cash_hours:number; cheque_pay:number; cash_pay:number;
  total_pay:number; status:string; notes:string; holiday_notes:string[]; rule_locations?:string[];
  daily_over_14_alerts?:Array<{date:string;gross_hours:number;locations:string[]}>;
  is_new?:boolean; new_until?:string; employee_labels?:string[]; wage_change_note?:string|null; wage_change_source?:WageChangeSource; detail_change_note?:string|null;
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
  locationHolidayHours:Record<string,number>,
  wage:number,
  cashWage:number,
  cap=88,
){
  const locations = new Set([...Object.keys(locationRegularHours), ...Object.keys(locationHolidayHours)]);
  return [...locations].reduce((sum,location)=>{
    const rounded=roundQuarterHour(Number(locationRegularHours[location]||0));
    const holiday=Number(locationHolidayHours[location]||0);
    const holidayCheque=Math.min(Math.max(0,holiday),8,cap);
    const regularCap=Math.max(0,cap-holidayCheque);
    const cheque=Math.min(rounded,regularCap);
    const cash=Math.max(0,rounded-cheque)+Math.max(0,holiday-holidayCheque);
    return {
      rounded:round2(sum.rounded+rounded),
      cheque:round2(sum.cheque+cheque),
      cash:round2(sum.cash+cash),
      chequePay:round2(sum.chequePay+cheque*wage),
      cashPay:round2(sum.cashPay+cash*cashWage),
      holidayCheque:round2(sum.holidayCheque+holidayCheque),
      holidayCash:round2(sum.holidayCash+Math.max(0,holiday-holidayCheque)),
      holidayPay:round2(sum.holidayPay+holidayCheque*wage*1.5),
    };
  },{rounded:0,cheque:0,cash:0,chequePay:0,cashPay:0,holidayCheque:0,holidayCash:0,holidayPay:0});
}

function combinedAllocation(regularPayable:number,holidayHours:number,wage:number,cashWage:number,cap=88){
  return locationDefaultAllocation({ combined: regularPayable }, { combined: holidayHours }, wage, cashWage, cap);
}

function filterLocationHours(source:Record<string,number>,locations:Set<string>,include=true){
  return Object.fromEntries(Object.entries(source).filter(([location])=>locations.has(normalize(location))===include));
}

function holidayCapNote(allocation:{holidayCheque:number;holidayCash:number},cap:number){
  return allocation.holidayCash>0
    ? `Holiday payroll capped at ${round2(allocation.holidayCheque)}h; ${round2(allocation.holidayCash)}h moved to cash so cheque hours stay within ${cap}h.`
    : '';
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
    const dailyGross=new Map<string,{gross:number;locations:Set<string>}>();
    let payable=0,regularPayable=0,holidayHours=0,holidayPay=0,gross=0,breakMinutes=0,weightedWage=0;
    for(const punch of items){
      const hours=Number(punch.payroll_hours ?? punch.hours ?? 0);const grossHours=Number(punch.gross_hours||0)||hours;
      const punchDate=getPayrollDate(punch.clocked_in);const holiday=holidayMap.get(punchDate);const isHoliday=Boolean(holiday);const punchWage=Number(punch.wage||0);
      payable+=hours;gross+=grossHours;breakMinutes+=Number(punch.break_minutes||0);weightedWage+=hours*Number(punch.wage||0);
      const location=punch.location||'Unknown';locations.add(location);locationHours[location]=(locationHours[location]||0)+hours;locationGross[location]=(locationGross[location]||0)+grossHours;locationBreaks[location]=(locationBreaks[location]||0)+Number(punch.break_minutes||0)/60;
      if(punchDate){const existing=dailyGross.get(punchDate)||{gross:0,locations:new Set<string>()};existing.gross+=grossHours;existing.locations.add(location);dailyGross.set(punchDate,existing);}
      if(isHoliday){holidayHours+=hours;locationHolidayHours[location]=(locationHolidayHours[location]||0)+hours;holidayNotes.add(`${holiday!.name}: ${round2(hours)}h worked`);}
      else{regularPayable+=hours;locationRegularHours[location]=(locationRegularHours[location]||0)+hours;}
      if(punch.role||punch.department)roles.add(punch.role||punch.department||'');
    }
    const dailyOver14Alerts=[...dailyGross.entries()].filter(([,value])=>value.gross>14.2).map(([date,value])=>({date,gross_hours:round2(value.gross),locations:[...value.locations].sort()})).sort((a,b)=>a.date.localeCompare(b.date));
    const combinedRounded=roundQuarterHour(regularPayable);const wage=payable>0?weightedWage/payable:Number(first.wage||0);const cashWage=Number(first.cash_wage||0)||wage;const rule=ruleFor(employeeId,first.employee_name,rules,periodEnd);
    let cap=88;let rounded=combinedRounded;let allocation=combinedAllocation(regularPayable,holidayHours,wage,cashWage,cap);let cheque=allocation.cheque,cash=allocation.cash;holidayPay=allocation.holidayPay;let status=allocation.cash>0?'Over 88/holiday cap → cash':'',notes=rule?.notes||'';
    if(usesPerLocationDefaultCap(rule)){
      const locationAllocation=locationDefaultAllocation(locationRegularHours,locationHolidayHours,wage,cashWage,cap);
      rounded=locationAllocation.rounded;cheque=locationAllocation.cheque;cash=locationAllocation.cash;holidayPay=locationAllocation.holidayPay;
      status=cash>0?'Over 88 at one or more locations → cash':(rule?.rule_type==='PAY_UNDER_OTHER_LOCATION'?`Pay under ${rule.payroll_location||'other location'}`:(rule?.rule_type==='NOTE_ONLY'&&notes?'Review note':''));
    }
    if(rule?.rule_type==='CASH_ONLY'){cheque=0;cash=round2(rounded+holidayHours);holidayPay=0;status='CASH (all)';}
    if(rule?.rule_type==='PARTIAL_CASH'){
      const cashLocations=locationSet(rule.combined_locations);
      const fixedCashHours=Number(rule.rule_value||0);
      const rawCash=cashLocations.size
        ? Object.entries(locationRegularHours).reduce((sum,[location,hours])=>sum+(cashLocations.has(normalize(location))?hours:0),0)
        : 0;
      const requestedCash=cashLocations.size?roundQuarterHour(rawCash):roundQuarterHour(fixedCashHours);
      if(cashLocations.size){
        const nonCashAllocation=locationDefaultAllocation(
          filterLocationHours(locationRegularHours,cashLocations,false),
          filterLocationHours(locationHolidayHours,cashLocations,false),
          wage,
          cashWage,
          cap,
        );
        const cashHolidayHours=Object.entries(locationHolidayHours).reduce((sum,[location,hours])=>sum+(cashLocations.has(normalize(location))?Number(hours||0):0),0);
        cheque=nonCashAllocation.cheque;
        cash=round2(nonCashAllocation.cash+requestedCash+cashHolidayHours);
        rounded=round2(nonCashAllocation.rounded+requestedCash);
        holidayPay=nonCashAllocation.holidayPay;
      } else {
        const base=combinedAllocation(regularPayable,holidayHours,wage,cashWage,cap);
        const regularCash=Math.max(base.cash,Math.min(combinedRounded,requestedCash));
        cash=round2(regularCash);
        cheque=round2(Math.max(0,combinedRounded-cash));
        holidayPay=base.holidayPay;
      }
      status=cash>0?(cashLocations.size?'Partial cash by location':`Partial cash ${cash}h`):'Partial cash rule';
    }
    if(rule?.rule_type==='HOLD_PAYROLL'){cheque=0;cash=0;holidayPay=0;status='HOLD — NO PAY';}
    if(rule?.rule_type==='PAYROLL_HOURS_CAP'||rule?.rule_type==='COMBINED_LOCATION_CAP'){
      cap=Math.max(0,Number(rule.rule_value||0));allocation=combinedAllocation(regularPayable,holidayHours,wage,cashWage,cap);cheque=allocation.cheque;cash=allocation.cash;holidayPay=allocation.holidayPay;status=`Exception ${cap}h`;
    }
    if(rule?.rule_type==='NOTE_ONLY'&&notes)status='Review note';
    let chequePay=cheque*wage,cashPay=cash*cashWage;
    if(usesPerLocationDefaultCap(rule)){
      const locationAllocation=locationDefaultAllocation(locationRegularHours,locationHolidayHours,wage,cashWage,cap);
      chequePay=locationAllocation.chequePay;cashPay=locationAllocation.cashPay;holidayPay=locationAllocation.holidayPay;
    }
    if(rule?.rule_type==='SALARY_FIXED'){cheque=rounded;cash=0;holidayPay=0;chequePay=Number(rule.rule_value||0);cashPay=0;status='SALARY FIXED';}
    const finalHolidayAllocation=rule?.rule_type==='CASH_ONLY'||rule?.rule_type==='HOLD_PAYROLL'||rule?.rule_type==='SALARY_FIXED'
      ? {holidayCheque:0,holidayCash:0}
      : usesPerLocationDefaultCap(rule)
      ? locationDefaultAllocation(locationRegularHours,locationHolidayHours,wage,cashWage,cap)
      : combinedAllocation(regularPayable,holidayHours,wage,cashWage,cap);
    for(const location of Object.keys(locationHolidayHours)){
      const localAllocation=locationDefaultAllocation({[location]:locationRegularHours[location]||0},{[location]:locationHolidayHours[location]||0},wage,cashWage,cap);
      locationHolidayPay[location]=localAllocation.holidayPay;
    }
    const capNote=holidayCapNote(finalHolidayAllocation,cap);
    if(holidayHours>0&&capNote)holidayNotes.add(capNote);
    const unpaidBreak=Math.max(0,gross-payable);const totalBreak=breakMinutes/60;const paidBreak=Math.max(0,totalBreak-unpaidBreak);
    const holidayNoteText=[...holidayNotes].join('; ');
    const dailyOver14Text=dailyOver14Alerts.map(alert=>`Daily over 14.2h: ${alert.date} recorded ${alert.gross_hours.toFixed(2)}h at ${alert.locations.join(', ')}`).join('; ');
    const finalNotes=[holidayNoteText,dailyOver14Text,notes].filter(Boolean).join('; ');
    return {employee_id:employeeId,employee_name:first.employee_name,locations:[...locations].sort(),roles:[...roles].filter(Boolean).sort(),
      location_hours:Object.fromEntries(Object.entries(locationHours).map(([key,value])=>[key,round2(value)])),location_regular_hours:Object.fromEntries(Object.entries(locationRegularHours).map(([key,value])=>[key,round2(value)])),location_holiday_hours:Object.fromEntries(Object.entries(locationHolidayHours).map(([key,value])=>[key,round2(value)])),location_holiday_pay:Object.fromEntries(Object.entries(locationHolidayPay).map(([key,value])=>[key,round2(value)])),location_gross_hours:Object.fromEntries(Object.entries(locationGross).map(([key,value])=>[key,round2(value)])),location_break_hours:Object.fromEntries(Object.entries(locationBreaks).map(([key,value])=>[key,round2(value)])),wage:round2(wage),cash_wage:round2(cashWage),rule_type:rule?.rule_type||'STANDARD',rule_value:Number(rule?.rule_value||0),rule_locations:[...locationSet(rule?.combined_locations)],cheque_cap:cap,gross_hours:round2(gross),break_hours:round2(totalBreak),
      unpaid_break_hours:round2(unpaidBreak),paid_break_hours:round2(paidBreak),payable_hours:round2(payable),regular_payable_hours:round2(regularPayable),holiday_hours:round2(holidayHours),holiday_pay:round2(holidayPay),rounded_hours:round2(rounded),cheque_hours:round2(cheque),cash_hours:round2(cash),
      cheque_pay:round2(chequePay),cash_pay:round2(cashPay),total_pay:round2(chequePay+cashPay+holidayPay),status,notes:finalNotes,holiday_notes:[...holidayNotes],daily_over_14_alerts:dailyOver14Alerts};
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
  const localAllocation = locationDefaultAllocation({[location]:regularPayable},{[location]:holidayHours},row.wage,row.cash_wage,row.cheque_cap||88);
  const localRounded = localAllocation.rounded;
  const perLocationDefaultCap = row.rule_type === 'STANDARD' || row.rule_type === 'NOTE_ONLY' || row.rule_type === 'PAY_UNDER_OTHER_LOCATION';
  const partialCashLocations = new Set((row.rule_locations || []).map(normalize));
  const partialCashByLocation = row.rule_type === 'PARTIAL_CASH' && partialCashLocations.size > 0;
  const selectedLocationIsCash = partialCashByLocation && partialCashLocations.has(normalize(location));
  const share = row.regular_payable_hours > 0 ? regularPayable / row.regular_payable_hours : 0;
  const cashOnly = row.rule_type === 'CASH_ONLY';
  const holdPayroll = row.rule_type === 'HOLD_PAYROLL';
  const salaryFixed = row.rule_type === 'SALARY_FIXED';
  const chequeHours = holdPayroll || cashOnly || selectedLocationIsCash ? 0 : salaryFixed ? localRounded : (perLocationDefaultCap || partialCashByLocation) ? localAllocation.cheque : round2(row.cheque_hours * share);
  const cashHours = holdPayroll || salaryFixed ? 0 : (cashOnly || selectedLocationIsCash) ? round2(localRounded + holidayHours) : (perLocationDefaultCap || partialCashByLocation) ? localAllocation.cash : round2(row.cash_hours * share);
  const chequePay = holdPayroll || cashOnly || selectedLocationIsCash ? 0 : salaryFixed ? round2(row.cheque_pay * share) : (perLocationDefaultCap || partialCashByLocation) ? localAllocation.chequePay : round2(row.cheque_pay * share);
  const cashPay = holdPayroll || salaryFixed ? 0 : (cashOnly || selectedLocationIsCash) ? round2(cashHours * row.cash_wage) : (perLocationDefaultCap || partialCashByLocation) ? localAllocation.cashPay : round2(row.cash_pay * share);
  const cappedHolidayPay = (perLocationDefaultCap || partialCashByLocation) && !selectedLocationIsCash ? localAllocation.holidayPay : selectedLocationIsCash ? 0 : holidayPay;
  const dailyOver14Alerts = (row.daily_over_14_alerts || []).filter(alert=>alert.locations.includes(location));
  return {
    ...row,
    gross_hours:round2(gross),
    break_hours:round2(breaks),
    unpaid_break_hours:round2(unpaidBreak),
    paid_break_hours:round2(Math.max(0,breaks-unpaidBreak)),
    payable_hours:round2(payable),
    regular_payable_hours:round2(regularPayable),
    holiday_hours:round2(holidayHours),
    holiday_pay:round2(cappedHolidayPay),
    rounded_hours:localRounded,
    cheque_hours:chequeHours,
    cash_hours:cashHours,
    cheque_pay:chequePay,
    cash_pay:cashPay,
    total_pay:round2(chequePay+cashPay+cappedHolidayPay),
    status:`${row.status ? `${row.status} · ` : ''}Location hours`,
    notes:`Showing ${location} hours with its own ${row.cheque_cap || 88}h cheque cap${partialCashByLocation ? ' (partial-cash rule applies only to its selected cash location(s))' : perLocationDefaultCap ? '' : ' (special employee rule allocated from the combined result)'}. ${row.notes || ''}`.trim(),
    daily_over_14_alerts:dailyOver14Alerts,
  };
}
