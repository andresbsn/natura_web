import { describe, expect, it } from 'vitest';

import { isMultipartProductBody, productUpdateSchema } from './admin.products.routes.js';

describe('admin product update input', () => {
  it('converts multipart boolean strings', () => {
    expect(productUpdateSchema.parse({ isActive: 'false' }).isActive).toBe(false);
    expect(productUpdateSchema.parse({ isActive: 'true' }).isActive).toBe(true);
    expect(productUpdateSchema.parse({ isActive: false }).isActive).toBe(false);
  });

  it('rejects arbitrary boolean strings', () => {
    expect(() => productUpdateSchema.parse({ isActive: 'no' })).toThrow();
  });

  it('detects multer bodies without a prototype', () => {
    const body = Object.assign(Object.create(null), { sku: 'SKU-1' });
    expect(isMultipartProductBody(body)).toBe(true);
  });
});
