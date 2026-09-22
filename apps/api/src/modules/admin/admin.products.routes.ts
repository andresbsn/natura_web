import type { Prisma } from '@prisma/client';
import fs from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { prisma } from '../../db/prisma.js';
import { AppError } from '../../http/errors.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { mapCategory, mapProduct } from '../products/product.mappers.js';
import { productInclude } from '../products/product.queries.js';

export const adminProductsRouter = Router();

adminProductsRouter.use(requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'));

const productUploadDir = path.resolve(process.cwd(), 'uploads/products');
const allowedImageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

fs.mkdirSync(productUploadDir, { recursive: true });

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, productUploadDir),
    filename: (_req, file, cb) => {
      const extensionByMimeType: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
      };
      cb(null, `${randomUUID()}${extensionByMimeType[file.mimetype] ?? path.extname(file.originalname)}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!allowedImageMimeTypes.has(file.mimetype)) {
      cb(new AppError(400, 'La imagen debe ser JPG, PNG o WebP', 'INVALID_IMAGE_TYPE'));
      return;
    }

    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

const categorySchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(140).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  isActive: z.boolean().optional(),
});

const imageUrlSchema = z.string().refine(
  (url) => z.string().url().safeParse(url).success || /^\/uploads\/products\/[a-f0-9-]+\.(?:jpg|png|webp)$/.test(url),
  'Invalid url',
);

const imageSchema = z.object({
  url: imageUrlSchema,
  altText: z.string().max(180).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const variantSchema = z.object({
  sku: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  attributes: z.record(z.unknown()).optional(),
  stockQuantity: z.number().int().min(0).default(0),
  price: z.number().positive(),
  isActive: z.boolean().optional(),
});

const productCreateSchema = z.object({
  categoryId: z.string().uuid().optional(),
  name: z.string().min(1).max(180),
  slug: z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().max(3000).optional(),
  line: z.string().max(120).optional(),
  isActive: z.boolean().optional(),
  images: z.array(imageSchema).default([]),
  variants: z.array(variantSchema).min(1),
});

const productUpdateSchema = productCreateSchema.partial().extend({
  variants: z.array(variantSchema).optional(),
  images: z.array(imageSchema).optional(),
});

function variantCreateData(variant: z.infer<typeof variantSchema>): Prisma.ProductVariantCreateWithoutProductInput {
  return {
    sku: variant.sku,
    name: variant.name,
    attributes: variant.attributes as Prisma.InputJsonValue | undefined,
    stockQuantity: variant.stockQuantity,
    isActive: variant.isActive ?? true,
    prices: {
      create: { amount: variant.price },
    },
  };
}

function variantUpdateData(variant: z.infer<typeof variantSchema>): Prisma.ProductVariantUpdateInput {
  return {
    sku: variant.sku,
    name: variant.name,
    attributes: variant.attributes as Prisma.InputJsonValue | undefined,
    stockQuantity: variant.stockQuantity,
    isActive: variant.isActive ?? true,
  };
}

function auditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function uploadedImage(file: Express.Multer.File | undefined, altText: string) {
  return file
    ? [
        {
          url: `/uploads/products/${file.filename}`,
          altText,
          sortOrder: 0,
        },
      ]
    : undefined;
}

async function deleteUploadedFile(file: Express.Multer.File | undefined) {
  if (!file) {
    return;
  }

  await unlink(file.path).catch(() => undefined);
}

async function deleteLocalProductImages(images: Array<{ url: string }>) {
  await Promise.all(
    images
      .filter((image) => image.url.startsWith('/uploads/products/'))
      .map((image) => unlink(path.join(productUploadDir, path.basename(image.url))).catch(() => undefined)),
  );
}

function productPayload(body: Record<string, unknown>, file: Express.Multer.File | undefined) {
  const name = String(body.name ?? '');
  const uploadedImages = uploadedImage(file, name);

  return {
    categoryId: body.categoryId ? String(body.categoryId) : undefined,
    name,
    slug: String(body.slug ?? ''),
    description: body.description ? String(body.description) : undefined,
    line: body.line ? String(body.line) : undefined,
    isActive: body.isActive === undefined ? undefined : body.isActive === 'true' || body.isActive === true,
    ...(uploadedImages ? { images: uploadedImages } : {}),
    variants: [
      {
        sku: String(body.sku ?? ''),
        name: String(body.variantName ?? 'Unidad'),
        stockQuantity: Number(body.stockQuantity ?? 0),
        price: Number(body.price ?? 0),
      },
    ],
  };
}

function parseProductCreateBody(body: unknown, file: Express.Multer.File | undefined) {
  if (file || body instanceof Object && !Array.isArray(body) && 'sku' in body) {
    return productCreateSchema.parse(productPayload(body as Record<string, unknown>, file));
  }

  return productCreateSchema.parse(body);
}

function parseProductUpdateBody(body: unknown, file: Express.Multer.File | undefined) {
  if (file || body instanceof Object && !Array.isArray(body) && 'sku' in body) {
    return productUpdateSchema.parse(productPayload(body as Record<string, unknown>, file));
  }

  return productUpdateSchema.parse(body);
}

adminProductsRouter.get('/categories', async (_req, res, next) => {
  try {
    const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
    res.json({ categories: categories.map(mapCategory) });
  } catch (error) {
    next(error);
  }
});

adminProductsRouter.post('/categories', async (req, res, next) => {
  try {
    const data = categorySchema.parse(req.body);
    const category = await prisma.category.create({ data });
    res.status(201).json({ category: mapCategory(category) });
  } catch (error) {
    next(error);
  }
});

adminProductsRouter.patch('/categories/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const data = categorySchema.partial().parse(req.body);
    const category = await prisma.category.update({ where: { id }, data });
    res.json({ category: mapCategory(category) });
  } catch (error) {
    next(error);
  }
});

adminProductsRouter.get('/products', async (req, res, next) => {
  try {
    const query = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), search: z.string().trim().min(1).max(120).optional(), isActive: z.coerce.boolean().optional() }).parse(req.query);
    const paginate = req.query.page !== undefined || req.query.pageSize !== undefined;
    const where = { ...(query.isActive === undefined ? {} : { isActive: query.isActive }), ...(query.search ? { OR: [{ name: { contains: query.search, mode: 'insensitive' as const } }, { slug: { contains: query.search, mode: 'insensitive' as const } }] } : {}) };
    const [products, total] = await prisma.$transaction([prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: productInclude,
      ...(paginate ? { skip: (query.page - 1) * query.pageSize, take: query.pageSize } : {}),
    }), prisma.product.count({ where })]);
    res.json({ products: products.map((product) => mapProduct(product, true, true)), pagination: { page: query.page, pageSize: paginate ? query.pageSize : total, total, totalPages: paginate ? Math.ceil(total / query.pageSize) : 1 } });
  } catch (error) {
    next(error);
  }
});

adminProductsRouter.post('/products', imageUpload.single('image'), async (req, res, next) => {
  try {
    const data = parseProductCreateBody(req.body, req.file);
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          category: data.categoryId ? { connect: { id: data.categoryId } } : undefined,
          name: data.name,
          slug: data.slug,
          description: data.description,
          line: data.line,
          isActive: data.isActive ?? true,
          images: {
            create: data.images.map((image) => ({
              url: image.url,
              altText: image.altText,
              sortOrder: image.sortOrder ?? 0,
            })),
          },
          variants: {
            create: data.variants.map(variantCreateData),
          },
        },
        include: productInclude,
      });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.id,
          entityType: 'Product',
          entityId: created.id,
          action: 'CREATE',
          after: auditJson(created),
        },
      });

      return created;
    });

    res.status(201).json({ product: mapProduct(product, false, true) });
  } catch (error) {
    await deleteUploadedFile(req.file);
    next(error);
  }
});

adminProductsRouter.patch('/products/:id', imageUpload.single('image'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const data = parseProductUpdateBody(req.body, req.file);
    const existing = await prisma.product.findUnique({ where: { id }, include: productInclude });

    if (!existing) {
      throw new AppError(404, 'Product not found', 'PRODUCT_NOT_FOUND');
    }

    const product = await prisma.$transaction(async (tx) => {
      if (data.images) {
        await tx.productImage.deleteMany({ where: { productId: id } });
      }

      await tx.product.update({
        where: { id },
        data: {
          category: data.categoryId ? { connect: { id: data.categoryId } } : undefined,
          name: data.name,
          slug: data.slug,
          description: data.description,
          line: data.line,
          isActive: data.isActive,
          ...(data.images
            ? {
                images: {
                  create: data.images.map((image) => ({
                    url: image.url,
                    altText: image.altText,
                    sortOrder: image.sortOrder ?? 0,
                  })),
                },
              }
            : {}),
        },
        include: productInclude,
      });

      if (data.variants) {
        const currentVariant = existing.variants[0];
        const nextVariant = data.variants[0];

        if (currentVariant && nextVariant) {
          await tx.productVariant.update({ where: { id: currentVariant.id }, data: variantUpdateData(nextVariant) });
          const basePrice = await tx.price.findFirst({ where: { variantId: currentVariant.id, catalogId: null } });
          if (basePrice) await tx.price.update({ where: { id: basePrice.id }, data: { amount: nextVariant.price } });
          else await tx.price.create({ data: { variantId: currentVariant.id, amount: nextVariant.price } });
        } else if (nextVariant) {
          await tx.productVariant.create({ data: { ...variantCreateData(nextVariant), product: { connect: { id } } } });
        }
      }

      const reloaded = await tx.product.findUniqueOrThrow({ where: { id }, include: productInclude });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.id,
          entityType: 'Product',
          entityId: id,
          action: 'UPDATE',
          before: auditJson(existing),
          after: auditJson(reloaded),
        },
      });

      return reloaded;
    });

    if (req.file && data.images) {
      await deleteLocalProductImages(existing.images);
    }

    res.json({ product: mapProduct(product, false, true) });
  } catch (error) {
    await deleteUploadedFile(req.file);
    next(error);
  }
});
