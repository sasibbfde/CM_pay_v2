export const BONUS_CATEGORIES = [
  'attendance',
  'inventory',
  'cleaning',
  'labour_control',
  'customer_service_leadership',
] as const;

export type BonusCategory = typeof BONUS_CATEGORIES[number];

export type ManagerBonusScores = Record<BonusCategory, number | null>;

export type ManagerBonusRubricItem = {
  id: string;
  label: string;
  description: string;
};

export const DEFAULT_MANAGER_BONUS_POOL = 50;
export const DEFAULT_MANAGER_BONUS_MAX_POINTS = 50;

export const MANAGER_BONUS_RUBRICS: Record<'Front' | 'Kitchen', ManagerBonusRubricItem[]> = {
  Front: [
    { id:'attendance_reliability', label:'Attendance & Reliability', description:'Punctuality, attendance, schedule adherence, accountability.' },
    { id:'floor_leadership', label:'Floor Leadership', description:'Manager presence on the floor, coaching the team, table touches, problem resolution, host station support, table turn management.' },
    { id:'guest_experience', label:'Guest Experience', description:'Customer service, guest complaints, Google reviews, hospitality standards, recovery of guest issues.' },
    { id:'cleanliness_standards', label:'Cleanliness Standards', description:'Daily cleanliness audits, dining room, washrooms, kitchen appearance, organization, health inspection readiness.' },
    { id:'inventory_control', label:'Inventory Control', description:'Weekly inventory, cutlery, glassware, plates, smallwares, waste control, ordering follow-up.' },
    { id:'sop_compliance', label:'SOP & Compliance', description:'Completion of ComplianceMate checklists, SOP execution, food safety, operational standards.' },
    { id:'reporting_communication', label:'Reporting & Communication', description:'Daily logbooks, manager reports, Black Box review, shift communication, follow-up on action items.' },
    { id:'labour_scheduling', label:'Labour & Scheduling', description:"Review next day's reservations, labour optimization, scheduling efficiency, controlling labour costs." },
    { id:'team_development', label:'Team Development', description:'Successful onboarding of new hires, coaching, training, accountability, team engagement.' },
    { id:'sales_performance', label:'Sales & Performance', description:'Beverage upselling, sales growth, promotional execution, achieving operational KPIs.' },
  ],
  Kitchen: [
    { id:'attendance_reliability', label:'Attendance & Reliability', description:'Punctuality, attendance, schedule adherence, accountability.' },
    { id:'kitchen_leadership_line', label:'Kitchen Leadership & Line Management', description:'Station coverage, ticket times, line coordination, expo accuracy, handling rushes.' },
    { id:'food_quality_consistency', label:'Food Quality & Consistency', description:'Recipe adherence, plate presentation, consistency across shifts and stations.' },
    { id:'cleanliness_sanitation', label:'Cleanliness & Sanitation', description:'Kitchen, walk-in, and storage cleanliness; health inspection readiness.' },
    { id:'inventory_food_cost', label:'Inventory & Food Cost Control', description:'Ordering, par levels, waste control, food cost %, follow-up on variances.' },
    { id:'sop_food_safety', label:'SOP & Food Safety Compliance', description:'ComplianceMate checklists, temperature logs, HACCP/food safety standards.' },
    { id:'reporting_communication', label:'Reporting & Communication', description:'Prep lists, waste logs, shift handoff notes, follow-up on action items.' },
    { id:'labour_scheduling', label:'Labour & Scheduling', description:'Kitchen labour cost control, scheduling efficiency against forecasted covers.' },
    { id:'team_development', label:'Team Development', description:'Training and onboarding cooks/dishwashers, coaching, accountability, engagement.' },
    { id:'kitchen_performance_kpis', label:'Kitchen Performance & KPIs', description:'Ticket times, food cost achievement, menu execution, operational KPIs.' },
  ],
};

export function isManager(department?: string | null, role?: string | null) {
  const value = `${department || ''} ${role || ''}`.toLowerCase();
  return value.includes('manager') || value.includes('management');
}

export function normalizeRating(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 5) throw new Error('Ratings must be whole numbers from 0 to 5');
  return number;
}

export function calculateManagerBonus(originalBonus: number, scores: ManagerBonusScores, extraRate = 0.5) {
  const totalPoints = BONUS_CATEGORIES.reduce((sum, category) => sum + (scores[category] || 0), 0);
  const scorePercent = totalPoints / 25;
  const maxExtraBonus = originalBonus * extraRate;
  const earnedExtraBonus = maxExtraBonus * scorePercent;
  return {
    totalPoints,
    scorePercent,
    maxExtraBonus,
    earnedExtraBonus,
    finalBonus: originalBonus + earnedExtraBonus,
  };
}

export function managerBonusTrack(department?: string | null, role?: string | null): 'Front' | 'Kitchen' {
  const value = `${department || ''} ${role || ''}`.toLowerCase();
  if (/(kitchen|back of house|boh|chef|cook|wok|curry|prep|dish|packer)/i.test(value)) return 'Kitchen';
  return 'Front';
}

export function rubricForManager(department?: string | null, role?: string | null) {
  return MANAGER_BONUS_RUBRICS[managerBonusTrack(department, role)];
}

export function normalizeRubricRatings(value: unknown) {
  if (!Array.isArray(value)) return null;
  const normalized = value.slice(0, DEFAULT_MANAGER_BONUS_MAX_POINTS / 5).map(rating => normalizeRating(rating));
  while (normalized.length < DEFAULT_MANAGER_BONUS_MAX_POINTS / 5) normalized.push(null);
  return normalized;
}

export function legacyScoresToRubricRatings(scores: ManagerBonusScores) {
  const ratings = Array(DEFAULT_MANAGER_BONUS_MAX_POINTS / 5).fill(null) as Array<number | null>;
  ratings[0] = scores.attendance ?? null;
  ratings[3] = scores.cleaning ?? null;
  ratings[4] = scores.inventory ?? null;
  ratings[7] = scores.labour_control ?? null;
  ratings[8] = scores.customer_service_leadership ?? null;
  return ratings;
}

export function rubricRatingsToLegacyScores(ratings: Array<number | null | undefined>): ManagerBonusScores {
  return {
    attendance: ratings[0] ?? null,
    inventory: ratings[4] ?? null,
    cleaning: ratings[3] ?? null,
    labour_control: ratings[7] ?? null,
    customer_service_leadership: ratings[8] ?? null,
  };
}

export function calculateTemplateManagerBonus(
  originalBonus: number,
  rubricRatings: Array<number | null | undefined>,
  bonusPool = DEFAULT_MANAGER_BONUS_POOL,
  maxPoints = DEFAULT_MANAGER_BONUS_MAX_POINTS,
) {
  const safePool = Number.isFinite(Number(bonusPool)) ? Number(bonusPool) : DEFAULT_MANAGER_BONUS_POOL;
  const safeMaxPoints = Number.isFinite(Number(maxPoints)) && Number(maxPoints) > 0 ? Number(maxPoints) : DEFAULT_MANAGER_BONUS_MAX_POINTS;
  const totalPoints = rubricRatings.reduce<number>((sum, rating) => sum + (Number(rating) || 0), 0);
  const scorePercent = totalPoints / safeMaxPoints;
  const maxExtraBonus = originalBonus * (safePool / 100);
  const earnedExtraBonus = maxExtraBonus * scorePercent;
  return {
    totalPoints,
    scorePercent,
    bonusPool:safePool,
    maxPoints:safeMaxPoints,
    maxExtraBonus,
    earnedExtraBonus,
    finalBonus: originalBonus + earnedExtraBonus,
  };
}
