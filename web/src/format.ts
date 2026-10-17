const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const compactCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const integer = new Intl.NumberFormat('en-US');
const dateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const shortDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export const formatMoney = (value: number) => currency.format(value);
export const formatMoneyCompact = (value: number) => compactCurrency.format(value);
export const formatNumber = (value: number) => integer.format(value);
export const formatPercent = (value: number) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)}%`;
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => date.format(new Date(iso));

/** Formats a calendar day ("2025-10-03") without shifting it into the browser's timezone. */
export const formatDay = (day: string) => shortDay.format(new Date(`${day}T00:00:00Z`));
