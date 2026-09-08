import type { OrderStatus, StockMovementType } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { AppError } from '../../http/errors.js';
import { applyBestPromotion, type PromotionCandidate } from '../promotions/promotion-calculator.js';

export const RESERVED_ORDER_STATUSES: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PREPARING'];

export type OrderStockItem = {
  variantId: string;
  quantity: number;
};

export type OrderStockAction = {
  movementType: StockMovementType;
  reason: string;
  decrementStock: boolean;
  releaseReservation: boolean;
};

export type OrderEditItemInput = {
  variantId: string;
  quantity: number;
};

export type PricedVariant = {
  id: string;
  sku: string;
  name: string;
  stockQuantity: number;
  promotions?: PromotionCandidate[];
  product: { name: string; promotions?: PromotionCandidate[]; category?: { promotions?: PromotionCandidate[] } | null };
  prices: Array<{ amount: Prisma.Decimal; catalog?: { promotions?: PromotionCandidate[] } | null }>;
};

export type RecalculatedOrderItem = {
  variantId: string;
  productNameSnapshot: string;
  variantNameSnapshot: string;
  skuSnapshot: string;
  unitPrice: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  quantity: number;
  lineTotal: Prisma.Decimal;
};

export function isReservedOrderStatus(status: OrderStatus) {
  return RESERVED_ORDER_STATUSES.includes(status);
}

export function assertAdminOrderStatusTransition(currentStatus: OrderStatus, nextStatus: OrderStatus | undefined) {
  if (!nextStatus || nextStatus === currentStatus) return;

  if (currentStatus === 'DELIVERED') {
    throw new AppError(409, 'Delivered orders cannot change operational status', 'ORDER_STATUS_LOCKED');
  }

  if (currentStatus === 'CANCELLED') {
    throw new AppError(409, 'Cancelled orders cannot change operational status', 'ORDER_STATUS_LOCKED');
  }

}

export function orderStockAction(currentStatus: OrderStatus, nextStatus: OrderStatus | undefined): OrderStockAction | null {
  if (!nextStatus || nextStatus === currentStatus) return null;

  if (nextStatus === 'DELIVERED' && isReservedOrderStatus(currentStatus)) {
    return {
      movementType: 'ORDER_FULFILLED',
      reason: 'Entrega de pedido',
      decrementStock: true,
      releaseReservation: false,
    };
  }

  if (nextStatus === 'CANCELLED' && isReservedOrderStatus(currentStatus)) {
    return {
      movementType: 'ORDER_RELEASED',
      reason: 'Cancelacion admin',
      decrementStock: false,
      releaseReservation: true,
    };
  }

  return null;
}

export function mergeOrderItems(items: OrderEditItemInput[]) {
  return Array.from(
    items.reduce((totals, item) => {
      totals.set(item.variantId, (totals.get(item.variantId) ?? 0) + item.quantity);
      return totals;
    }, new Map<string, number>()),
    ([variantId, quantity]) => ({ variantId, quantity }),
  );
}

export function recalculateOrderItems(items: OrderEditItemInput[], variants: PricedVariant[]) {
  const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
  const mergedItems = mergeOrderItems(items);
  const recalculatedItems = mergedItems.map((item) => {
    const variant = variantsById.get(item.variantId);
    const price = variant?.prices[0];

    if (!variant || !price) {
      throw new AppError(400, 'Product is not available', 'PRODUCT_UNAVAILABLE');
    }

    const promotion = applyBestPromotion(price.amount, [
      ...(variant.promotions ?? []),
      ...(variant.product.promotions ?? []),
      ...(variant.product.category?.promotions ?? []),
      ...(price.catalog?.promotions ?? []),
    ]);
    const unitPrice = promotion?.finalPrice ?? price.amount;
    const discountAmount = promotion?.discountAmount ?? new Prisma.Decimal(0);
    const lineTotal = unitPrice.mul(item.quantity);

    return {
      variantId: variant.id,
      productNameSnapshot: variant.product.name,
      variantNameSnapshot: variant.name,
      skuSnapshot: variant.sku,
      unitPrice,
      discountAmount,
      quantity: item.quantity,
      lineTotal,
    };
  });
  const subtotal = recalculatedItems.reduce((total, item) => total.add(item.lineTotal), new Prisma.Decimal(0));

  return { items: recalculatedItems, subtotal };
}

export function orderItemQuantityDiffs(before: OrderEditItemInput[], after: OrderEditItemInput[]) {
  const beforeTotals = mergeOrderItems(before).reduce((totals, item) => totals.set(item.variantId, item.quantity), new Map<string, number>());
  const afterTotals = mergeOrderItems(after).reduce((totals, item) => totals.set(item.variantId, item.quantity), new Map<string, number>());
  const variantIds = new Set([...beforeTotals.keys(), ...afterTotals.keys()]);

  return Array.from(variantIds)
    .map((variantId) => ({
      variantId,
      quantity: (afterTotals.get(variantId) ?? 0) - (beforeTotals.get(variantId) ?? 0),
    }))
    .filter((diff) => diff.quantity !== 0);
}
