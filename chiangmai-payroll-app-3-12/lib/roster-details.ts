type RosterDetail = { location:string; department:string; role:string; wage?:number };

const normalize = (value:string) => value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');

// High-confidence matches from Employee Mastersheet Roaster 2026-2.xlsx.
// Payroll-only new employees are marked separately and never overwrite an
// existing employee value.
const DETAILS:Record<string,RosterDetail> = Object.fromEntries([
  ['Aashish Gautam','Chiang Mai Danforth','Back of House','Curry',17.6],
  ['Ankit Chhetri','Chiang Mai Mississauga','Back of House','Wok',18.5],
  ['Chuni Gurung','Chiang Mai Mississauga','Back of House','Kitchen Manager',27],
  ['Jamyang Selden','Chiang Mai Mississauga','Front of House','Server',17.6],
  ['Jamyang Seldenn','Chiang Mai Mississauga','Front of House','Server',17.6],
  ['Jane Vu','Chiang Mai Mississauga','Manager','Manager',25],
  ['Trinh Kieu Jane Vu','Chiang Mai Mississauga','Manager','Manager',25],
  ['Kasish Upreti','Chiang Mai Danforth','Front of House','Host',17.6],
  ['Kevin Komkit Narasing','Chiang Mai Mississauga','Back of House','Expo',30],
  ['Kristen Y','Chiang Mai Mississauga','Manager','Manager',25],
  ['Kei Xin Kristen Yu','Chiang Mai Mississauga','Manager','Manager',25],
  ['Maaya Motoe','Chiang Mai Danforth','Back of House','Packer',17.6],
  ['Manali Saxena','Chiang Mai York Mills','Manager','Manager',30],
  ['Panipak Kitjumroen','Chiang Mai Danforth','Front of House','Server',17.6],
  ['Patcharasin Charoenrungruang','Chiang Mai Danforth','Back of House','Wok',18],
  ['Pinatap Matthew Srisa Ardphunwong','Chiang Mai Danforth','Manager','Manager',27],
  ['Rajat Gaba','Chiang Mai Mississauga','Back of House','Wok',23],
  ['Ronish Nagarkoti','Chiang Mai Liberty Village','Back of House','Curry',17.6],
  ['Ronish Ron Nagarkoti','Chiang Mai Liberty Village','Back of House','Curry',17.6],
  ['Sandip Dhungana','Chiang Mai Danforth','Back of House','Wok',18.5],
  ['Sarangan Karunanithy','Chiang Mai York Mills','Back of House','Wok',25],
  ['Vincent Selva','Chiang Mai Junction','Management','Manager',undefined],
  ['Yoora Byeon','Chiang Mai Danforth','Back of House','Packer',17.6],
  // Current-period employees present in Payroll_Jun16-30_2026_ROUNDED.xlsx.
  ['Harsh Kothiya','Chiang Mai Parklawn','Front of House','Bartender',16.5],
  ['Malik Luca Wahbi','Chiang Mai Mississauga','Front of House','Host',17.6],
  ['Pailin Nukranad','Chiang Mai Mississauga','Back of House','Expo',27],
  ['Vinith Paskaran','Chiang Mai Mississauga','Back of House','Wok',25],
].map(([name,location,department,role,wage])=>[normalize(String(name)),{location:String(location),department:String(department),role:String(role),wage:wage==null?undefined:Number(wage)}]));

export function getRosterDetail(fullName:string) { return DETAILS[normalize(fullName)]; }

export function fillMissingRosterDetails<T extends {full_name:string;location?:string|null;department?:string|null;role?:string|null;wage?:number|null}>(employee:T):T {
  const detail=getRosterDetail(employee.full_name);
  if(!detail)return employee;
  return {...employee,
    location:String(employee.location||'').trim()?employee.location:detail.location,
    department:String(employee.department||'').trim()?employee.department:detail.department,
    role:String(employee.role||'').trim()?employee.role:detail.role,
    wage:Number(employee.wage||0)>0?employee.wage:(detail.wage??employee.wage),
  };
}

