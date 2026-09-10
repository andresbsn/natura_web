import type { DiscountType, PromotionScope } from '@prisma/client';
import { Prisma } from '@prisma/client';

export type PromotionCandidate = {
  id: string;
  name: string;
  scope: PromotionScope;
  discountType: DiscountType;
  value: Prisma.Decimal;
  priority: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
};

export type AppliedPromotion = {
  id: string;
  name: string;
  discountType: DiscountType;
  discountAmount: Prisma.Decimal;
  finalPrice: Prisma.Decimal;
};

export function isPromotionActive(promotion: PromotionCandidate, now = new Date()) {
  return promotion.isActive && (!promotion.startsAt || promotion.startsAt <= now) && (!promotion.endsAt || now < promotion.endsAt);
}

export function promotionDiscount(basePrice: Prisma.Decimal, promotion: PromotionCandidate) {
  if (promotion.discountType === 'PERCENTAGE') {
    return basePrice.mul(promotion.value).div(100);
  }

  if (promotion.discountType === 'FIXED_PRICE') {
    return basePrice.sub(promotion.value);
  }

  return promotion.value;
}

export function applyBestPromotion(basePrice: Prisma.Decimal, promotions: PromotionCandidate[], now = new Date()): AppliedPromotion | null {
  const candidates = promotions
    .filter((promotion) => isPromotionActive(promotion, now))
    .map((promotion) => {
      const discountAmount = Prisma.Decimal.min(Prisma.Decimal.max(promotionDiscount(basePrice, promotion), new Prisma.Decimal(0)), basePrice);
      return { promotion, discountAmount, finalPrice: basePrice.sub(discountAmount) };
    })
    .filter((candidate) => candidate.discountAmount.greaterThan(0))
    .sort((a, b) => b.promotion.priority - a.promotion.priority || b.discountAmount.comparedTo(a.discountAmount));

  const best = candidates[0];
  if (!best) return null;

  return {
    id: best.promotion.id,
    name: best.promotion.name,
    discountType: best.promotion.discountType,
    discountAmount: best.discountAmount,
    finalPrice: best.finalPrice,
  };
}
