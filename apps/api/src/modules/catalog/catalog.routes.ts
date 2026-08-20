import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../../db/prisma.js';
import { AppError } from '../../http/errors.js';
import { mapCategory, mapProduct } from '../products/product.mappers.js';
import { findProductBySlug, productInclude } from '../products/product.queries.js';

export const catalogRouter = Router();

const catalogQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  categorySlug: z.string().trim().min(1).optional(),
});

catalogRouter.get('/categories', async (_req, res, next) => {
  try {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json({ categories: categories.map(mapCategory) });
  } catch (error) {
    next(error);
  }
});

catalogRouter.get('/delivery-methods', async (_req, res, next) => {
  try {
    const deliveryMethods = await prisma.deliveryMethod.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    res.json({
      deliveryMethods: deliveryMethods.map((method) => ({
        id: method.id,
        name: method.name,
        description: method.description,
        cost: method.cost.toNumber(),
        requiresAddress: method.requiresAddress,
        isActive: method.isActive,
      })),
    });
  } catch (error) {
    next(error);
  }
});

catalogRouter.get('/products', async (req, res, next) => {
  try {
    const query = catalogQuerySchema.parse(req.query);
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { description: { contains: query.search, mode: 'insensitive' } },
                { line: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(query.categorySlug ? { category: { slug: query.categorySlug, isActive: true } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: productInclude,
    });

    res.json({ products: products.map(mapProduct) });
  } catch (error) {
    next(error);
  }
});

catalogRouter.get('/products/:slug', async (req, res, next) => {
  try {
    const slug = z.string().min(1).parse(req.params.slug);
    const product = await findProductBySlug(slug);

    if (!product) {
      throw new AppError(404, 'Product not found', 'PRODUCT_NOT_FOUND');
    }

    res.json({ product: mapProduct(product) });
  } catch (error) {
    next(error);
  }
});
