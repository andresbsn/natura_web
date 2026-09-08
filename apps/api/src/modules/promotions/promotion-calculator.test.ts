import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { applyBestPromotion } from './promotion-calculator.js';

describe('promotion calculator', () => {
  it('applies percentage, fixed amount and fixed price discounts', () => {
    const basePrice = new Prisma.Decimal(100);

    expect(applyBestPromotion(basePrice, [{ id: 'p1', name: '10 off', scope: 'PRODUCT', discountType: 'PERCENTAGE', value: new Prisma.Decimal(10), priority: 1, startsAt: null, endsAt: null, isActive: true }])?.finalPrice.toNumber()).toBe(90);
    expect(applyBestPromotion(basePrice, [{ id: 'p2', name: '15 off', scope: 'PRODUCT', discountType: 'FIXED_AMOUNT', value: new Prisma.Decimal(15), priority: 1, startsAt: null, endsAt: null, isActive: true }])?.finalPrice.toNumber()).toBe(85);
    expect(applyBestPromotion(basePrice, [{ id: 'p3', name: 'Final', scope: 'PRODUCT', discountType: 'FIXED_PRICE', value: new Prisma.Decimal(70), priority: 1, startsAt: null, endsAt: null, isActive: true }])?.finalPrice.toNumber()).toBe(70);
  });

  it('uses priority before discount amount', () => {
    const promotion = applyBestPromotion(new Prisma.Decimal(100), [
      { id: 'low', name: '50 off', scope: 'PRODUCT', discountType: 'PERCENTAGE', value: new Prisma.Decimal(50), priority: 1, startsAt: null, endsAt: null, isActive: true },
      { id: 'high', name: '10 off', scope: 'PRODUCT', discountType: 'PERCENTAGE', value: new Prisma.Decimal(10), priority: 2, startsAt: null, endsAt: null, isActive: true },
    ]);

    expect(promotion?.id).toBe('high');
    expect(promotion?.finalPrice.toNumber()).toBe(90);
  });
});
