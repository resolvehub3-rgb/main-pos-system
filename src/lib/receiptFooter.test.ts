import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RECEIPT_FOOTER, receiptFooterText } from './receiptFooter.ts';

test('a shop that never edited its footer prints the default note', () => {
  assert.equal(receiptFooterText({}), DEFAULT_RECEIPT_FOOTER);
  assert.equal(receiptFooterText({ receipt_footer: undefined }), DEFAULT_RECEIPT_FOOTER);
});

test('the owner’s note prints verbatim once saved', () => {
  assert.equal(
    receiptFooterText({ receipt_footer: 'Pay before you leave. No refunds without a receipt.' }),
    'Pay before you leave. No refunds without a receipt.',
  );
});

test('a cleared footer prints nothing rather than resurrecting the default', () => {
  assert.equal(receiptFooterText({ receipt_footer: '' }), '');
});
