import { Prisma } from '@prisma/client';

import { prisma } from '../../db/prisma.js';

export const productInclude = Prisma.validator<Prisma.ProductInclude>()({
  category: true,
  images: {
    orderBy: { sortOrder: 'asc' },
  },
  variants: {
    orderBy: { name: 'asc' },
    include: {
      prices: {
        orderBy: { createdAt: 'desc' },
        include: { catalog: true },
      },
      stockMovements: {
        where: {
          type: 'ORDER_RESERVED',
          order: { status: { in: ['PENDING', 'CONFIRMED', 'PREPARING'] } },
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
