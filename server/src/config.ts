export function parseTimezone(value: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    throw new Error(`Invalid STORE_TIMEZONE: ${value}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://stockroom:stockroom@localhost:5433/stockroom',
  storeTimezone: parseTimezone(process.env.STORE_TIMEZONE ?? 'America/New_York'),
  lowStockThreshold: 5,
};
