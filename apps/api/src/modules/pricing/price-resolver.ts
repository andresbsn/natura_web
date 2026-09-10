import { Prisma } from '@prisma/client';
import { applyBestPromotion, type AppliedPromotion, type PromotionCandidate } from '../promotions/promotion-calculator.js';

export type PriceResolutionInput = {
  id?: string;
  amount: Prisma.Decimal;
  catalogId?: string | null;
  catalog?: { id: string; startsAt: Date; endsAt: Date; isActive: boolean; promotions?: PromotionCandidate[] } | null;
};

export type EffectivePrice = { price: PriceResolutionInput; promotion: AppliedPromotion | null };

export function resolveEffectivePrice(prices: PriceResolutionInput[], promotions: PromotionCandidate[] = [], now = new Date()): EffectivePrice | null {
  const catalogPrice = prices.find((price) => price.catalogId && price.catalog?.isActive && price.catalog.startsAt <= now && now < price.catalog.endsAt);
  const basePrice = prices.find((price) => !price.catalogId);
  const price = catalogPrice ?? basePrice;
  if (!price) return null;
  return { price, promotion: applyBestPromotion(price.amount, [...promotions, ...(price.catalog?.promotions ?? [])], now) };
}
