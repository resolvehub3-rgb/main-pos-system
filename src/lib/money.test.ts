import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatGHS,
  calculateCartTotals,
  calculateCashChange,
  validateSplitPayments,
  calculateGrossProfit,
  roundToTwo,
} from './money.ts';

test('formatGHS formats standard Ghanaian Cedis correctly', () => {
  assert.equal(formatGHS(48750), 'GH₵ 48,750.00');
  assert.equal(formatGHS(5.5), 'GH₵ 5.50');
  assert.equal(formatGHS(0), 'GH₵ 0.00');
});

test('calculateCartTotals calculates subtotals, item discounts, and tax accurately', () => {
  const items = [
    { price: 5.5, quantity: 2 }, // 11.00
    { price: 2.0, quantity: 1 }, // 2.00
    { price: 45.0, quantity: 1 }, // 45.00
  ];
  // Subtotal = 58.00, no discount, no tax
  const totals = calculateCartTotals(items, 0, 0);
  assert.equal(totals.subtotal, 58.0);
  assert.equal(totals.discountTotal, 0);
  assert.equal(totals.total, 58.0);
});

test('calculateCartTotals handles line discount and global discount', () => {
  const items = [
    { price: 100, quantity: 1, discountPercent: 10 }, // 100 - 10 = 90
    { price: 50, quantity: 2 }, // 100
  ];
  // Subtotal = 200, line discount = 10 -> taxable = 190. Global discount 10% on remainder = 19 -> discountTotal = 29
  const totals = calculateCartTotals(items, 10, 0);
  assert.equal(totals.subtotal, 200);
  assert.equal(totals.discountTotal, 29);
  assert.equal(totals.total, 171);
});

test('calculateCashChange correctly computes change and sufficiency', () => {
  const check1 = calculateCashChange(58.0, 100.0);
  assert.equal(check1.changeDue, 42.0);
  assert.equal(check1.isSufficient, true);

  const check2 = calculateCashChange(58.0, 50.0);
  assert.equal(check2.changeDue, 0);
  assert.equal(check2.isSufficient, false);
});

test('validateSplitPayments ensures exact allocation', () => {
  const validSplits = [
    { method: 'Cash', amount: 30 },
    { method: 'Mobile Money', amount: 28 },
  ];
  const resValid = validateSplitPayments(validSplits, 58);
  assert.equal(resValid.isValid, true);
  assert.equal(resValid.remaining, 0);

  const invalidSplits = [
    { method: 'Cash', amount: 20 },
    { method: 'Mobile Money', amount: 28 },
  ];
  const resInvalid = validateSplitPayments(invalidSplits, 58);
  assert.equal(resInvalid.isValid, false);
  assert.equal(resInvalid.remaining, 10);
});

test('calculateGrossProfit accurately computes profit and margin', () => {
  const { grossProfit, grossMarginPercent } = calculateGrossProfit(4850, 2930);
  assert.equal(grossProfit, 1920.0);
  assert.equal(roundToTwo(grossMarginPercent), 39.59);
});
