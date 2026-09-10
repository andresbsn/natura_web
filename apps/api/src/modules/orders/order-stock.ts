import type { OrderStatus, StockMovementType } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { AppError } from '../../http/errors.js';
import type { PromotionCandidate } from '../promotions/promotion-calculator.js';
import { resolveEffectivePrice } from '../pricing/price-resolver.js';

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
  isActive?: boolean;
  promotions?: PromotionCandidate[];
  product: { name: string; isActive?: boolean; promotions?: PromotionCandidate[]; category?: { promotions?: PromotionCandidate[] } | null };
  prices: Array<{ id?: string; amount: Prisma.Decimal; catalogId?: string | null; catalog?: { id: string; startsAt: Date; endsAt: Date; isActive: boolean; promotions?: PromotionCandidate[] } | null }>;
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

export type FrozenOrderItem = Pick<RecalculatedOrderItem, 'variantId' | 'productNameSnapshot' | 'variantNameSnapshot' | 'skuSnapshot' | 'unitPrice' | 'discountAmount'>;

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

export function recalculateOrderItems(items: OrderEditItemInput[], variants: PricedVariant[], existingItems: FrozenOrderItem[] = []) {
  const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
  const existingItemsByVariantId = new Map(existingItems.map((item) => [item.variantId, item]));
  const mergedItems = mergeOrderItems(items);
  const recalculatedItems = mergedItems.map((item) => {
    const variant = variantsById.get(item.variantId);
    if (!variant) {
      throw new AppError(400, 'Product is not available', 'PRODUCT_UNAVAILABLE');
    }

    const frozenItem = existingItemsByVariantId.get(item.variantId);
    if (frozenItem) {
      return {
        variantId: item.variantId,
        productNameSnapshot: frozenItem.productNameSnapshot,
        variantNameSnapshot: frozenItem.variantNameSnapshot,
        skuSnapshot: frozenItem.skuSnapshot,
        unitPrice: frozenItem.unitPrice,
        discountAmount: frozenItem.discountAmount,
        quantity: item.quantity,
        lineTotal: frozenItem.unitPrice.mul(item.quantity),
      };
    }

    if (variant.isActive === false || variant.product.isActive === false) {
      throw new AppError(400, 'Product is not available', 'PRODUCT_UNAVAILABLE');
    }

    const resolved = resolveEffectivePrice(variant.prices, [
      ...(variant.promotions ?? []),
      ...(variant.product.promotions ?? []),
      ...(variant.product.category?.promotions ?? []),
    ]);
    if (!resolved) throw new AppError(400, 'Product is not available', 'PRODUCT_UNAVAILABLE');
    const unitPrice = resolved.promotion?.finalPrice ?? resolved.price.amount;
    const discountAmount = resolved.promotion?.discountAmount ?? new Prisma.Decimal(0);
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
