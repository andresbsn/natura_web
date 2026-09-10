import type { Prisma } from '@prisma/client';

import { resolveEffectivePrice } from '../pricing/price-resolver.js';
import { productInclude } from './product.queries.js';

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;
type CategoryModel = Prisma.CategoryGetPayload<Record<string, never>>;
type PriceWithCatalog = ProductWithRelations['variants'][number]['prices'][number];

function decimalToNumber(value: { toNumber(): number }) {
  return value.toNumber();
}

function mapPrice(price: PriceWithCatalog) {
  return {
    id: price.id,
    amount: decimalToNumber(price.amount),
    catalog: price.catalog
      ? {
          id: price.catalog.id,
          name: price.catalog.name,
          startsAt: price.catalog.startsAt,
          endsAt: price.catalog.endsAt,
          isActive: price.catalog.isActive,
        }
      : null,
  };
}

function mapCurrentPrice(variant: ProductWithRelations['variants'][number], product: ProductWithRelations) {
  const resolved = resolveEffectivePrice(variant.prices, [
    ...variant.promotions,
    ...product.promotions,
    ...(product.category?.promotions ?? []),
  ]);
  if (!resolved) return null;
  const { price, promotion } = resolved;

  return {
    ...mapPrice(price as PriceWithCatalog),
    amount: promotion ? decimalToNumber(promotion.finalPrice) : decimalToNumber(price.amount),
    originalAmount: decimalToNumber(price.amount),
    discountAmount: promotion ? decimalToNumber(promotion.discountAmount) : 0,
    promotion: promotion ? { id: promotion.id, name: promotion.name, discountType: promotion.discountType } : null,
  };
}

export function mapCategory(category: CategoryModel) {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    isActive: category.isActive,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

export function mapProduct(product: ProductWithRelations, includeHistoricalPrices = false, includeInactiveVariants = false) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    line: product.line,
    isActive: product.isActive,
    category: product.category ? mapCategory(product.category) : null,
    images: product.images.map((image) => ({
      id: image.id,
      url: image.url,
      altText: image.altText,
      sortOrder: image.sortOrder,
    })),
    variants: product.variants.filter((variant) => includeInactiveVariants || variant.isActive).map((variant) => {
      const reservedQuantity = variant.orderItems.reduce((total, item) => total + item.quantity, 0);
      const currentPrice = mapCurrentPrice(variant, product);

      return {
        id: variant.id,
        sku: variant.sku,
        name: variant.name,
        attributes: variant.attributes,
        stockQuantity: variant.stockQuantity,
        availableStock: Math.max(variant.stockQuantity - reservedQuantity, 0),
        reservedQuantity,
        isActive: variant.isActive,
        prices: includeHistoricalPrices
          ? variant.prices.map(mapPrice)
          : variant.prices.filter((price) => price.id === currentPrice?.id).map(mapPrice),
        currentPrice,
      };
    }),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}
