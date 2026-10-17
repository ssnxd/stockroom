export const toCents = (dollars: number): number => Math.round(dollars * 100);

export const toDollars = (cents: number): number => cents / 100;

// Half up, so 0.5 cents becomes 1.
export const percentOfCents = (cents: number, percent: number): number =>
  Math.round((cents * percent) / 100);
