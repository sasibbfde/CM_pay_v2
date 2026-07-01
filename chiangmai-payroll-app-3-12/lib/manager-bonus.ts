export const BONUS_CATEGORIES = [
  'attendance',
  'inventory',
  'cleaning',
  'labour_control',
  'customer_service_leadership',
] as const;

export type BonusCategory = typeof BONUS_CATEGORIES[number];

export type ManagerBonusScores = Record<BonusCategory, number | null>;

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

