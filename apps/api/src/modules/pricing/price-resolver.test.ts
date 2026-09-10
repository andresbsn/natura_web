import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { resolveEffectivePrice } from './price-resolver.js';

const base = { id: 'base', amount: new Prisma.Decimal('100'), catalogId: null };
const catalog = { id: 'campaign-price', amount: new Prisma.Decimal('80'), catalogId: 'campaign', catalog: { id: 'campaign', startsAt: new Date('2026-01-01'), endsAt: new Date('2026-02-01'), isActive: true } };

describe('resolveEffectivePrice', () => {
  it('uses an active catalog override', () => {
    expect(resolveEffectivePrice([base, catalog], [], new Date('2026-01-15'))?.price.id).toBe('campaign-price');
  });
  it('falls back to base outside the campaign and allows adjacent end', () => {
    expect(resolveEffectivePrice([base, catalog], [], new Date('2026-02-01'))?.price.id).toBe('base');
  });
  it('returns no price when neither base nor active override exists', () => {
    expect(resolveEffectivePrice([catalog], [], new Date('2026-03-01'))).toBeNull();
  });
});
