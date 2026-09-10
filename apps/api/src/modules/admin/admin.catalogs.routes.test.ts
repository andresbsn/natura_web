import { describe, expect, it } from 'vitest';

import { catalogPriceSchema } from './admin.catalogs.routes.js';

describe('catalog price bulk input', () => {
  it('accepts null to clear an override and rejects non-positive amounts', () => {
    const variantId = '00000000-0000-0000-0000-000000000001';
    expect(catalogPriceSchema.parse({ variantId, amount: null })).toEqual({ variantId, amount: null });
    expect(catalogPriceSchema.parse({ variantId, amount: 12.5 }).amount).toBe(12.5);
    expect(() => catalogPriceSchema.parse({ variantId, amount: 0 })).toThrow();
    expect(() => catalogPriceSchema.parse({ variantId, amount: -1 })).toThrow();
  });
});
