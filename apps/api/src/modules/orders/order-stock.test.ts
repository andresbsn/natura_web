import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { AppError } from '../../http/errors.js';
import { RESERVED_ORDER_STATUSES, assertAdminOrderStatusTransition, isReservedOrderStatus, mergeOrderItems, orderItemQuantityDiffs, orderStockAction, recalculateOrderItems } from './order-stock.js';

describe('order stock rules', () => {
  it('treats pending, confirmed and preparing orders as stock reservations', () => {
    expect(RESERVED_ORDER_STATUSES).toEqual(['PENDING', 'CONFIRMED', 'PREPARING']);
    expect(isReservedOrderStatus('PENDING')).toBe(true);
    expect(isReservedOrderStatus('CONFIRMED')).toBe(true);
    expect(isReservedOrderStatus('PREPARING')).toBe(true);
    expect(isReservedOrderStatus('DELIVERED')).toBe(false);
    expect(isReservedOrderStatus('CANCELLED')).toBe(false);
  });

  it('fulfills reserved stock when an active order is delivered', () => {
    expect(orderStockAction('CONFIRMED', 'DELIVERED')).toEqual({
      movementType: 'ORDER_FULFILLED',
      reason: 'Entrega de pedido',
      decrementStock: true,
      releaseReservation: false,
    });
  });

  it('releases reserved stock when an active order is cancelled', () => {
    expect(orderStockAction('PREPARING', 'CANCELLED')).toEqual({
      movementType: 'ORDER_RELEASED',
      reason: 'Cancelacion admin',
      decrementStock: false,
      releaseReservation: true,
    });
  });

  it('does not apply stock movement for status changes that keep the reservation active', () => {
    expect(orderStockAction('PENDING', 'CONFIRMED')).toBeNull();
    expect(orderStockAction('CONFIRMED', 'PREPARING')).toBeNull();
  });

  it('locks delivered and cancelled orders against operational status changes', () => {
    expect(() => assertAdminOrderStatusTransition('DELIVERED', 'CANCELLED')).toThrow(AppError);
    expect(() => assertAdminOrderStatusTransition('CANCELLED', 'PENDING')).toThrow(AppError);
    expect(() => assertAdminOrderStatusTransition('DELIVERED', undefined)).not.toThrow();
  });

  it('merges duplicate edited items by variant', () => {
    expect(mergeOrderItems([{ variantId: 'v1', quantity: 1 }, { variantId: 'v1', quantity: 3 }, { variantId: 'v2', quantity: 2 }])).toEqual([
      { variantId: 'v1', quantity: 4 },
      { variantId: 'v2', quantity: 2 },
    ]);
  });

  it('calculates signed quantity diffs for admin item edits', () => {
    expect(orderItemQuantityDiffs([{ variantId: 'v1', quantity: 3 }, { variantId: 'v2', quantity: 1 }], [{ variantId: 'v1', quantity: 1 }, { variantId: 'v3', quantity: 4 }])).toEqual([
      { variantId: 'v1', quantity: -2 },
      { variantId: 'v2', quantity: -1 },
      { variantId: 'v3', quantity: 4 },
    ]);
  });

  it('recalculates order item snapshots and subtotal from current variant prices', () => {
    const result = recalculateOrderItems([{ variantId: 'v1', quantity: 2 }], [{ id: 'v1', sku: 'SKU-1', name: 'Unidad', stockQuantity: 5, product: { name: 'Crema' }, prices: [{ amount: new Prisma.Decimal(123.45) }] }]);

    expect(result.items).toMatchObject([{ variantId: 'v1', productNameSnapshot: 'Crema', variantNameSnapshot: 'Unidad', skuSnapshot: 'SKU-1', quantity: 2 }]);
    expect(result.items[0].unitPrice.toNumber()).toBe(123.45);
    expect(result.items[0].lineTotal.toNumber()).toBe(246.9);
    expect(result.subtotal.toNumber()).toBe(246.9);
  });

  it('recalculates order items with active promotions', () => {
    const result = recalculateOrderItems([{ variantId: 'v1', quantity: 2 }], [{
      id: 'v1', sku: 'SKU-1', name: 'Unidad', stockQuantity: 5,
      product: { name: 'Crema' },
      prices: [{ amount: new Prisma.Decimal(100) }],
      promotions: [{ id: 'p1', name: 'Promo 20', scope: 'VARIANT', discountType: 'PERCENTAGE', value: new Prisma.Decimal(20), priority: 1, startsAt: null, endsAt: null, isActive: true }],
    }]);

    expect(result.items[0].unitPrice.toNumber()).toBe(80);
    expect(result.items[0].discountAmount.toNumber()).toBe(20);
    expect(result.items[0].lineTotal.toNumber()).toBe(160);
    expect(result.subtotal.toNumber()).toBe(160);
  });

  it('preserves frozen snapshots for existing variants and prices new variants currently', () => {
    const result = recalculateOrderItems(
      [{ variantId: 'existing', quantity: 3 }, { variantId: 'new', quantity: 1 }],
      [
        { id: 'existing', sku: 'NEW-SKU', name: 'Nuevo nombre', stockQuantity: 5, product: { name: 'Nuevo producto' }, prices: [{ amount: new Prisma.Decimal(200) }] },
        { id: 'new', sku: 'SKU-NEW', name: 'Nueva variante', stockQuantity: 5, product: { name: 'Nuevo producto' }, prices: [{ amount: new Prisma.Decimal(75) }] },
      ],
      [{ variantId: 'existing', productNameSnapshot: 'Producto original', variantNameSnapshot: 'Variante original', skuSnapshot: 'SKU-OLD', unitPrice: new Prisma.Decimal(100), discountAmount: new Prisma.Decimal(10) }],
    );

    expect(result.items[0]).toMatchObject({ variantId: 'existing', productNameSnapshot: 'Producto original', variantNameSnapshot: 'Variante original', skuSnapshot: 'SKU-OLD', quantity: 3 });
    expect(result.items[0].unitPrice.toNumber()).toBe(100);
    expect(result.items[0].discountAmount.toNumber()).toBe(10);
    expect(result.items[0].lineTotal.toNumber()).toBe(300);
    expect(result.items[1].unitPrice.toNumber()).toBe(75);
    expect(result.subtotal.toNumber()).toBe(375);
  });
});
