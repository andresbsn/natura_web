import { Prisma } from '@prisma/client';

import { prisma } from '../../db/prisma.js';
import { RESERVED_ORDER_STATUSES } from '../orders/order-stock.js';

export const productInclude = Prisma.validator<Prisma.ProductInclude>()({
  category: {
    include: { promotions: true },
  },
  promotions: true,
  images: {
    orderBy: { sortOrder: 'asc' },
  },
  variants: {
    orderBy: { name: 'asc' },
    include: {
      prices: {
        orderBy: { createdAt: 'desc' },
        include: { catalog: { include: { promotions: true } } },
      },
      promotions: true,
      orderItems: {
        where: {
          order: { status: { in: RESERVED_ORDER_STATUSES } },
        },
      },
    },
  },
});

export async function findProductBySlug(slug: string, activeOnly = true) {
  return prisma.product.findFirst({
    where: {
      slug,
      ...(activeOnly ? { isActive: true } : {}),
    },
    include: productInclude,
  });
}
