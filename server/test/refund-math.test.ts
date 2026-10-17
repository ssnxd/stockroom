import { describe, expect, it } from 'vitest';
import { allocateDiscount, linePaid, refundAmountForLine } from '../src/refund-math';

describe('allocateDiscount', () => {
  it('gives the leftover cent to the lowest line on equal remainders', () => {
    expect(allocateDiscount([1000, 1000, 1000], 100)).toEqual([34, 33, 33]);
  });

  it('shares a $10 discount on $40 and $60 lines as $4 and $6', () => {
    expect(allocateDiscount([4000, 6000], 1000)).toEqual([400, 600]);
  });

  it('allocates nothing when there is no discount', () => {
    expect(allocateDiscount([500, 1500], 0)).toEqual([0, 0]);
  });

  it('splits in proportion to line value and sums exactly to the discount', () => {
    const shares = allocateDiscount([333, 999, 1], 150);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(150);
    expect(shares).toEqual([38, 112, 0]);
  });

  it('lets a full discount cover every line', () => {
    expect(allocateDiscount([700, 300], 1000)).toEqual([700, 300]);
  });
});

describe('linePaid', () => {
  it('is the line total minus its discount share', () => {
    expect(linePaid(1000, 34)).toBe(966);
  });
});

describe('refundAmountForLine', () => {
  it('refunds one unit at a time as 333, 334, 333 for 3 units paid 1000', () => {
    expect(refundAmountForLine(1000, 3, 0, 1)).toBe(333);
    expect(refundAmountForLine(1000, 3, 1, 1)).toBe(334);
    expect(refundAmountForLine(1000, 3, 2, 1)).toBe(333);
  });

  it('refunds the same total whether units go back together or in parts', () => {
    expect(refundAmountForLine(1000, 3, 0, 3)).toBe(1000);
    expect(refundAmountForLine(1000, 3, 0, 2) + refundAmountForLine(1000, 3, 2, 1)).toBe(1000);
  });

  it('refunds nothing for a line that was fully discounted', () => {
    expect(refundAmountForLine(0, 4, 1, 2)).toBe(0);
  });
});
