// All amounts are integer cents.

// Spreads an order-level discount across lines in proportion to line value. Largest remainder, ties to the
// lowest index, so the shares always sum to the discount.
export function allocateDiscount(lineTotals: number[], discount: number): number[] {
  const subtotal = lineTotals.reduce((sum, t) => sum + t, 0);
  if (subtotal === 0 || discount === 0) return lineTotals.map(() => 0);

  const shares = lineTotals.map((t) => Math.floor((t * discount) / subtotal));
  const remainders = lineTotals.map((t, i) => t * discount - shares[i] * subtotal);
  let leftover = discount - shares.reduce((sum, s) => sum + s, 0);

  const order = lineTotals.map((_, i) => i).sort((a, b) => remainders[b] - remainders[a] || a - b);
  for (const i of order) {
    if (leftover === 0) break;
    shares[i]++;
    leftover--;
  }
  return shares;
}

export const linePaid = (lineTotal: number, discountShare: number): number => lineTotal - discountShare;

// Refund for `refunding` units of a line that has `alreadyRefunded` units refunded. The cumulative refund is
// rounded, and the last unit gets the exact remainder, so refunds on a line sum to what was paid.
export function refundAmountForLine(
  paid: number,
  quantity: number,
  alreadyRefunded: number,
  refunding: number,
): number {
  const cumulative = (units: number) => (units === quantity ? paid : Math.round((paid * units) / quantity));
  return cumulative(alreadyRefunded + refunding) - cumulative(alreadyRefunded);
}
