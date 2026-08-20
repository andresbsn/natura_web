import type { Prisma } from '@prisma/client';

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

export function mapProduct(product: ProductWithRelations) {
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
    variants: product.variants.map((variant) => {
      const reservedQuantity = variant.stockMovements.reduce((total, movement) => total + movement.quantity, 0);

      return {
        id: variant.id,
        sku: variant.sku,
        name: variant.name,
        attributes: variant.attributes,
        stockQuantity: variant.stockQuantity,
        availableStock: Math.max(variant.stockQuantity - reservedQuantity, 0),
        reservedQuantity,
        isActive: variant.isActive,
        prices: variant.prices.map(mapPrice),
        currentPrice: variant.prices[0] ? mapPrice(variant.prices[0]) : null,
      };
    }),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}
