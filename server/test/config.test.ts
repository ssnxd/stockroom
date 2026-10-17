import { describe, expect, it } from 'vitest';
import { parseTimezone } from '../src/config';

describe('parseTimezone', () => {
  it('returns a valid IANA zone unchanged', () => {
    expect(parseTimezone('America/New_York')).toBe('America/New_York');
  });

  it('throws a clear error for an invalid zone', () => {
    expect(() => parseTimezone('Not/AZone')).toThrow(/Invalid STORE_TIMEZONE/);
  });
});
