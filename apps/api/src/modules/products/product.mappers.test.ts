import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { mapProduct } from './product.mappers.js';

describe('product response variants', () => {
  it('hides inactive variants publicly but includes them for administration', () => {
    const product = {
      id: 'product-1', name: 'Producto', slug: 'producto', description: null, line: null, isActive: true,
      category: null, images: [], promotions: [], createdAt: new Date(), updatedAt: new Date(),
      variants: [
        { id: 'active', sku: 'ACTIVE', name: 'Activa', attributes: null, stockQuantity: 1, isActive: true, createdAt: new Date(), updatedAt: new Date(), prices: [{ id: 'price-1', amount: new Prisma.Decimal(10), catalogId: null, createdAt: new Date(), updatedAt: new Date(), variantId: 'active', catalog: null }], promotions: [], orderItems: [] },
        { id: 'inactive', sku: 'INACTIVE', name: 'Inactiva', attributes: null, stockQuantity: 1, isActive: false, createdAt: new Date(), updatedAt: new Date(), prices: [{ id: 'price-2', amount: new Prisma.Decimal(20), catalogId: null, createdAt: new Date(), updatedAt: new Date(), variantId: 'inactive', catalog: null }], promotions: [], orderItems: [] },
      ],
    } as Parameters<typeof mapProduct>[0];

    expect(mapProduct(product).variants.map((variant) => variant.id)).toEqual(['active']);
    expect(mapProduct(product, true, true).variants.map((variant) => variant.id)).toEqual(['active', 'inactive']);
  });
});
