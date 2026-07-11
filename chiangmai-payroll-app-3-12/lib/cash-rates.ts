export type CashRateEntry = {
  location: string;
  name: string;
  cash_wage: number;
  last_seen: string;
};

const RAW_CASH_RATES = `location,name,cash_wage,last_seen
Danforth,"Basnet, Abishek",17.6,June
Danforth,"Basnet, Reejan",17,June
Danforth,"Bista, Ishan",19,June
Danforth,"Buddee, Peerapong (Get)",21,June
Danforth,"Chaiya, Kritsadaporn (Jing)",20,April
Danforth,"Giri, Biraj",17.6,April
Danforth,"Gunjaruen, saowalak (layla)",20,June
Danforth,Gwyn,17.6,April
Danforth,kaito,17.6,May
Danforth,Khim,25,June
Danforth,"Kunalbalasingam, Thishok",15,June
Danforth,"Lin , Steven",18.5,June
Danforth,"Luangson, Phanuwit (Peter)",18,June
Danforth,"Puri, Reena",17.6,June
Danforth,"Rattanamayoon, Vorraphop (Oak)",23,June
Danforth,"Sherpa, Dawa",18,June
Danforth,"Shrestha, Bivash",17.6,June
Danforth,"Skider, Noor",17.6,June
Danforth,"Srisa-Ardphunwong, Pinatap (Matthew)",27,June
Danforth,"Suresh, Amal",17.6,June
Danforth,To,18,May
Imm,"Basnet, Sudarshan",20,June
Imm,"Kaur, Komalpreet",27.5,May
Imm,"Koirala, Abhishek",20,June
Imm,"Neelakandan, Logenthiran",18.5,June
Imm,Safal Acharya,17.6,June
Imm,"Sitoula, Sujal",17.5,June
Imm,"Steven, Uncle",18.5,June
Imm,"Thai, Seng",25,June
Imm,"Tharmarasa, Thanujan",18.5,June
Imm,Thashapthan Ruthukumar,17.6,June
Junction,"Ehamparanathan, Sankeerthan",17.2,June
Junction,Elizabeth lee,25,June
Junction,"Karki, Shishir",18.5,May
Junction,"Magar, Manish",21,June
Junction,Mayank,30,May
Junction,"Pailin Nukranad,",26,June
Junction,"Pammika, Shrestha",17.6,June
Junction,"Paskaran, Vinith",21,January
Junction,"Pathmanathan, Kayanthan (Krupa)",21,June
Junction,Pemba,19,June
Junction,"Periyasamy, Gopinath",16,June
Junction,Ravikanth Rasadurai,20,June
Junction,"Shah, Amit",24,June
Junction,"Sherchan, Sandip",18,June
Junction,"Subedi, Niraj",19,June
Junction,Sushabya Pradhan,22,June
Junction,"Vamathevan, Vamarajah",23,June
Junction,"Vellaisamy, Raman",17.6,June
Junction,Vincent,25,March
Junction,"Vu, Jane",25,June
Junction,"Yamsiri, Budsarin (Fluke)",19,June
Liberty,"Acharya, Sandeep",18,June
Liberty,"Anand, Mayank",30,May
Liberty,"Barroga, Nina Christel",22,June
Liberty,Bilive Khatri,18,June
Liberty,"Chalise, Bhumika",17.75,June
Liberty,"Chapradit, Yupin",20,June
Liberty,"Dasanayaka Gunarathna Banneh, Sanduni",17.6,June
Liberty,"Dhakal, Anamol",18.5,June
Liberty,"Dhital, Himal",25,June
Liberty,"Ifran, (Ronnie) Mohammed",21,June
Liberty,"Jungco, Joeseto Porras",18.5,April
Liberty,"Kanagalingam, Gowrishangar",16.6,June
Liberty,"Kharel, Laxman",21.5,June
Liberty,"Kitjaroen, Watcharin",21.5,June
Liberty,"Lee, Elizabeth ( Liz)",25,June
Liberty,"Logaruban, Neelakandan",20.5,June
Liberty,"Marcelo, Macky",23.5,June
Liberty,"Nakeenthiran, Nitharsan",25,May
Liberty,"Navaradnam, Subendra",17,June
Liberty,Nitharshan,25,June
Liberty,"Nukranad, Pailin",25,April
Liberty,"Pandey, Aakash",19,June
Liberty,"Pariyar, Nikhil",18,May
Liberty,"Patmanathan, Kajipan",18,June
Liberty,"Selva, Vincent",25,April
Liberty,Shathursan Vikkinesvararasa,17.6,June
Liberty,"Thapa, Bishal",17.6,May
Liberty,"Thapa, Sahil",17.6,April
Liberty,"Vaikunthan, Kukaram",19,June
Mississauga,"( Lama, Sang Dolma)",17.6,May
Mississauga,akash,17.6,June
Mississauga,"Ale, Nishan",19,May
Mississauga,"Bali, Anjali",17.6,May
Mississauga,"Basnet, Sujan",17.6,May
Mississauga,"Bi, Chongshan",17.6,April
Mississauga,bibhor,17,June
Mississauga,"Bosstan, Ahmed",17.6,May
Mississauga,"Changsathien, Monthol",21,May
Mississauga,"Chen,Yin Ling ( Selena)",17.6,May
Mississauga,"Chhetri, Ankit",18.5,May
Mississauga,"Chirddilok, Issariya",21,June
Mississauga,chuni,25,June
Mississauga,"Dano, Sam",17.6,June
Mississauga,"Devi, Pampa",17.6,May
Mississauga,"Duong, Long (johnny )",17.6,May
Mississauga,Fern,25,May
Mississauga,"Gaba, Rajat",23,April
Mississauga,"Hill, Joji",17.6,May
Mississauga,"Iharratane, Kalila",17.6,May
Mississauga,"Ilao, Marvin",19,June
Mississauga,"Jaisi, Lachhuman",18,June
Mississauga,Jane,23,June
Mississauga,"Jati, Anchal",18,June
Mississauga,"Karki, Prakash Kumar",20,June
Mississauga,"Kennath, Amelie",17.6,May
Mississauga,"Kerr, Deianna",17.6,May
Mississauga,Kevin Komkit,25,June
Mississauga,kexin yu,23,June
Mississauga,"Khatri, Naresh Kumar",19,June
Mississauga,"Khemraj, Andrea Khushi",17.6,May
Mississauga,khim,25,June
Mississauga,"Knight, Chanelle",17.6,May
Mississauga,"Lapuz, Loraine",17.6,May
Mississauga,"Lin, Ting-yu",17.6,May
Mississauga,"Magar, Uttam Roka",19,May
Mississauga,"Majoulin, Daniel",17.6,May
Mississauga,manali,25,May
Mississauga,"Manoharan, Madasamy",19,June
Mississauga,"Marjorie Briggs, Skyla",17.6,May
Mississauga,matthew,26,June
Mississauga,"Mehta, Nency",17.6,May
Mississauga,"Mingala, Amanda Laki",17.6,April
Mississauga,"Motawea, Tag",17.6,May
Mississauga,"Mungur, Sakarsing",19,June
Mississauga,"Napier, Savanna",17.6,April
Mississauga,"Narasing, Kevin (Komkit )",30,May
Mississauga,"Nelson, Siriluk",22,June
Mississauga,"Nepal, Debjan",18,June
Mississauga,"Netsripaiboon, Damrongsak",23,June
Mississauga,"Nitiprasongphol, Phongpera",25,May
Mississauga,"Noren, Esmeralda",17.6,May
Mississauga,"Oli, Khim Raj",20,June
Mississauga,"Olivia Napier, Savanna",17.6,April
Mississauga,"Opancia, Patrice Ann",17.6,May
Mississauga,"Ortega, Ralph",17.6,May
Mississauga,Pailin,25,June
Mississauga,"Pamorca, Ferly",17.6,May
Mississauga,"Paskaran, Vinith",23,June
Mississauga,"Pathmanathan, Uthaya Balan",19,June
Mississauga,"Paudel, Pradip",20.5,June
Mississauga,"Phumradi , Phatsaraporn",17.6,May
Mississauga,"Raveenthiran, Thuvarakan",19,June
Mississauga,"Rawal, Ketan",17,June
Mississauga,"Seldenn, Jamyang",17.6,May
Mississauga,"Sherpa, Dawa Jangmu",17.6,May
Mississauga,"Singh, Archie",17.6,May
Mississauga,"Sioson, Allaine Bettina",17.6,May
Mississauga,"Sison, Alyssa",17.6,May
Mississauga,Siva,19,May
Mississauga,"Sivakumar, Sivasankar",20,June
Mississauga,"Srisa-Ardphunwong, Pinatap (Matthew)",25,June
Mississauga,"Stephens, Asia",17.6,May
Mississauga,"Taguibao, Teresa",17.6,May
Mississauga,"Termpan, Pattaraporn",17.6,May
Mississauga,"Thakker, Stuti",17.6,May
Mississauga,"Thien Nguyen, Nhat",17.6,May
Mississauga,Thuvarakan,19,June
Mississauga,tom,25,June
Mississauga,"Trinh, Vi Tuong",17.6,May
Mississauga,"Valencia Hervias, Liliamne",17.6,May
Mississauga,Vinith,23,June
Mississauga,"Vu , Duc Duy",17.6,May
Mississauga,"Vu, Jane",25,May
Mississauga,"Wadhawan, Shrey",17.6,May
Mississauga,"Williams, Olabisi Oludolapo",17.6,May
Mississauga,"Yangzome, Tshering",17.6,May
Office,Chuni,27,March
Office,Komal,21,March
Office,Vincent,25,March
Parklawn,Anna Iuimaeva,20,June
Parklawn,April,15,June
Parklawn,Byan Chris Morris,20,June
Parklawn,Christian Castillo,15,June
Parklawn,Denys,15,June
Parklawn,Evita Faye Ellazar,20,June
Parklawn,Gwyneth,20,June
Parklawn,Harsh,16.5,June
Parklawn,Irene Tuliao,15,June
Parklawn,Jan Wendell,18,June
Parklawn,Jatinder,18,June
Parklawn,Jezz Geovanny Morales,15,June
Parklawn,John Marthy,20,June
Parklawn,John Rexur Catubig,20,June
Parklawn,Jonalyn,22,January
Parklawn,Julifer Domingo,20,June
Parklawn,Kumar Sabharwal,15,June
Parklawn,Kwinie,20,June
Parklawn,Manoj Kandel,20,June
Parklawn,Maverick Arcana,15,June
Parklawn,Mayank,30,January
Parklawn,Osmar Eduardo Marron Ponce,15,June
Parklawn,Prajwol Bikram Kumar,20,June
Parklawn,Renzo (bar),18.6,June
Parklawn,Reuel Jeush Lao,20,June
Parklawn,Riwaz Shrestha,15,June
Parklawn,Ronish Kumal,20,June
Parklawn,Saroj Bhusal,15,June
Parklawn,Saugat Gurung,20,June
Parklawn,Thawatchai Suwunagsorn,15,June
Parklawn,Vea Nycol Visaya,15,June
Parklawn,VIncent,25,April
Parklawn,Vinith,21,March
Yorkmills,"Aslam, Ash( Thaniya)",17.6,June
Yorkmills,"Balaraj, Thiyakaraya",17.6,June
Yorkmills,"Balasundaram, Thirusenthuran",23,June
Yorkmills,Bishal,19.5,June
Yorkmills,"Chandra Poudel, Purna",18.5,June
Yorkmills,Chuni,27,March
Yorkmills,Cj,20,June
Yorkmills,Ishika Varma,17.6,April
Yorkmills,Jenny,22,June
Yorkmills,Karunanithy Srangan,25,June
Yorkmills,Kim,20,June
Yorkmills,"Kulasekaram, Nirujan,",19.5,June
Yorkmills,"Kumar Thanojan, Siva",19.5,June
Yorkmills,Manali,25,June
Yorkmills,"Manandhar, Utshab",19.5,June
Yorkmills,Mark ( Gwen),17.6,June
Yorkmills,"Mendoza, Renzo",18.6,June
Yorkmills,Mithusan Rameshkumar,18.5,June
Yorkmills,"Nakee, Niroshan",27,June
Yorkmills,"Narasing, Kevin (Komkit )",30,June
Yorkmills,"Pailin Nukranad,",25,April
Yorkmills,"Parathvasan, Mohanasuntharam Parath",18.5,June
Yorkmills,"Paskaran, Vinith",23,June
Yorkmills,"Pratheepa, Krishnarasa",20,June
Yorkmills,"Rajkumar, Sajinthan",20,June
Yorkmills,"Rompe, Nicasio",18.5,June
Yorkmills,"Ruales Dalida, Leonora",17.6,June
Yorkmills,Sagar Pokharel,18.5,June
Yorkmills,Sanjib,19.5,June
Yorkmills,Sanjin,19.5,March
Yorkmills,"Sivaguru, Puvanenthira",17.6,June
Yorkmills,"Sivarasa, Sharujan",15,June
Yorkmills,"Thapa, Sandip",20,June
Yorkmills,"Tharmarasa, Thanujan",18.5,June
Yorkmills,Thuvikan rajendiran,18.5,June
Yorkmills,Valarmathy Rajadurai,17.6,June
Yorkmills,Valentina,25,June
Yorkmills,Vijenthiran Veluchchamy,18.5,June
Yorkmills,Vincent,25,June
Yorkmills,"yoganathan, Athiththan",23,June`;

const parseCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
};

const displayName = (name: string) => {
  const cleaned = (name || '').trim().replace(/\s+/g, ' ');
  if (!cleaned.includes(',')) return cleaned;
  const [last, ...rest] = cleaned.split(',');
  const first = rest.join(',').trim();
  return first && last.trim() ? `${first} ${last.trim()}`.replace(/\s+/g, ' ') : cleaned.replace(/,+$/, '');
};

export const currentCashRates: CashRateEntry[] = RAW_CASH_RATES
  .split('\n')
  .slice(1)
  .map(line => {
    const [location, name, cash_wage, last_seen] = parseCsvLine(line);
    return { location, name: displayName(name), cash_wage: Number(cash_wage), last_seen };
  })
  .filter(entry => entry.name && Number.isFinite(entry.cash_wage) && entry.cash_wage > 0);

export function normalizeCashRateLocation(location?: string | null) {
  const compact = (location || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!compact) return '';
  if (compact.includes('imm')) return 'imm';
  if (compact.includes('danforth')) return 'danforth';
  if (compact.includes('junction')) return 'junction';
  if (compact.includes('liberty')) return 'liberty';
  if (compact.includes('mississauga')) return 'mississauga';
  if (compact.includes('parklawn')) return 'parklawn';
  if (compact.includes('yorkmills') || compact.includes('yorkmill')) return 'yorkmills';
  if (compact.includes('office')) return 'office';
  return compact;
}

export function normalizeCashRateName(name?: string | null) {
  return displayName(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const tokenKey = (name?: string | null) => displayName(name || '')
  .toLowerCase()
  .match(/[a-z0-9]+/g)
  ?.sort()
  .join('') || '';

const byNameLocation = new Map<string, CashRateEntry>();
const byTokenLocation = new Map<string, CashRateEntry>();
const byName = new Map<string, CashRateEntry[]>();
const byToken = new Map<string, CashRateEntry[]>();

for (const entry of currentCashRates) {
  const location = normalizeCashRateLocation(entry.location);
  const name = normalizeCashRateName(entry.name);
  const tokens = tokenKey(entry.name);
  if (name) {
    byNameLocation.set(`${name}|${location}`, entry);
    byName.set(name, [...(byName.get(name) || []), entry]);
  }
  if (tokens) {
    byTokenLocation.set(`${tokens}|${location}`, entry);
    byToken.set(tokens, [...(byToken.get(tokens) || []), entry]);
  }
}

const commonRate = (entries?: CashRateEntry[]) => {
  if (!entries?.length) return undefined;
  const first = entries[0].cash_wage;
  return entries.every(entry => Math.abs(entry.cash_wage - first) < 0.001) ? first : undefined;
};

export function resolveCashWage(input: { name?: string | null; location?: string | null; cash_wage?: number | string | null }) {
  const name = normalizeCashRateName(input.name);
  const tokens = tokenKey(input.name);
  const location = normalizeCashRateLocation(input.location);

  const exact = byNameLocation.get(`${name}|${location}`) || byTokenLocation.get(`${tokens}|${location}`);
  if (exact) return exact.cash_wage;

  const sheetRate = commonRate(byName.get(name)) ?? commonRate(byToken.get(tokens));
  if (sheetRate) return sheetRate;

  const stored = Number(input.cash_wage || 0);
  return Number.isFinite(stored) && stored > 0 ? stored : 0;
}

export function applyCashWage<T extends { cash_wage?: number | string | null; full_name?: string | null; employee_name?: string | null; location?: string | null }>(row: T): T {
  const cash_wage = resolveCashWage({
    name: row.full_name || row.employee_name,
    location: row.location,
    cash_wage: row.cash_wage,
  });
  return cash_wage > 0 ? { ...row, cash_wage } : row;
}
