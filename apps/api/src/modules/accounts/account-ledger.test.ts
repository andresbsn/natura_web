import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';

import { calculateCancellationEffect, calculateCancelledPaymentStatus, calculatePaymentReversalEffect, calculatePaymentStatus, canReduceOrderTotal, creditApplicationMovementKey, isCreditApplicationAllowed, isRetryableAccountingError, isUniqueConstraintError, reclassifyPaymentsForCancellation, reclassifyPaymentsForReducedTotal, splitPayment, totalAdjustmentMovementKey } from './account-ledger.js';

const money = (value: number) => new Prisma.Decimal(value);

describe('accounting payment coverage', () => {
  it('combines valid payments and manually applied credit', () => {
    expect(calculatePaymentStatus(money(100), money(60), money(40), true)).toBe('PAID');
    expect(calculatePaymentStatus(money(100), money(20), money(30), true)).toBe('PARTIALLY_PAID');
  });

  it('does not mark an order paid from reversed payment history', () => {
    expect(calculatePaymentStatus(money(100), money(0), money(0), true)).toBe('REFUNDED');
    expect(calculatePaymentStatus(money(100), money(0), money(0), false)).toBe('UNPAID');
  });

  it('preserves refunded status after reversing the last payment', () => {
    expect(calculatePaymentStatus(money(100), money(0), money(0), true)).toBe('REFUNDED');
  });

  it('cancels customer coverage without reusing the old applied amount', () => {
    expect(calculateCancelledPaymentStatus(money(100), true)).toBe('REFUNDED');
    expect(calculateCancelledPaymentStatus(money(100), false)).toBe('UNPAID');
  });

  it('keeps overpayment separate from order debt', () => {
    const result = splitPayment(money(150), money(100));
    expect(result.appliedAmount.toNumber()).toBe(100);
    expect(result.creditAmount.toNumber()).toBe(50);
  });

  it('reverses only the unallocated payment credit', () => {
    const result = calculatePaymentReversalEffect(money(100), money(50), money(30), false);
    expect(result.debtToRestore.toNumber()).toBe(100);
    expect(result.creditToRemove.toNumber()).toBe(20);
  });

  it('cancellation restores payment/application contributions but not cancelled debt', () => {
    expect(calculateCancellationEffect(money(100), money(40), money(20))).toEqual({
      debtToRelease: money(40),
      creditToRestore: money(60),
    });
    expect(calculateCancellationEffect(money(100), money(0), money(0)).creditToRestore.toNumber()).toBe(0);
  });

  it('does not allow application beyond available credit or order debt', () => {
    expect(isCreditApplicationAllowed(money(40), money(50), money(100))).toBe(true);
    expect(isCreditApplicationAllowed(money(60), money(50), money(100))).toBe(false);
    expect(isCreditApplicationAllowed(money(40), money(50), money(30))).toBe(false);
  });

  it('uses a stable movement key for idempotent credit applications', () => {
    expect(creditApplicationMovementKey('request-123')).toBe(creditApplicationMovementKey('request-123'));
  });

  it('reclassifies only excess payment when an order total is reduced', () => {
    const result = reclassifyPaymentsForReducedTotal([
      { id: 'b', amount: money(60), status: 'PAID', createdAt: new Date('2026-01-01') },
      { id: 'a', amount: money(60), status: 'PAID', createdAt: new Date('2026-01-01') },
    ], money(80), money(0));
    expect(result.map((payment) => [payment.id, payment.appliedAmount.toNumber(), payment.creditAmount.toNumber()])).toEqual([
      ['a', 60, 0],
      ['b', 20, 40],
    ]);
  });

  it('moves applied payment coverage to reusable credit on cancellation', () => {
    const result = reclassifyPaymentsForCancellation([
      { id: 'active', appliedAmount: money(60), creditAmount: money(10), status: 'PAID', reversedAt: null },
      { id: 'refunded', appliedAmount: money(20), creditAmount: money(0), status: 'REFUNDED', reversedAt: new Date() },
    ]);
    expect(result).toEqual([{ id: 'active', appliedAmount: money(0), creditAmount: money(70) }]);
  });

  it('rejects reducing an order below active applied credit and preserves request keys', () => {
    expect(canReduceOrderTotal(money(79), money(80))).toBe(false);
    expect(canReduceOrderTotal(money(80), money(80))).toBe(true);
    expect(totalAdjustmentMovementKey('order-1', 'request-1')).toBe(totalAdjustmentMovementKey('order-1', 'request-1'));
    expect(totalAdjustmentMovementKey('order-1', 'request-1')).not.toBe(totalAdjustmentMovementKey('order-1', 'request-2'));
  });

  it('classifies idempotency and retryable database errors explicitly', () => {
    expect(isUniqueConstraintError({ code: 'P2002' })).toBe(true);
    expect(isUniqueConstraintError({ code: 'P2034' })).toBe(false);
    expect(isRetryableAccountingError({ code: 'P2034' })).toBe(true);
    expect(isRetryableAccountingError({ message: 'deadlock detected (40P01)' })).toBe(true);
  });
});
