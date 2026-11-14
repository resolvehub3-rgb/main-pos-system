import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isMarketingRoutePath,
  marketingPageTitle,
  normalizeMarketingPath,
} from '../../landing/src/lib/marketingRoute.ts';

test('normalizeMarketingPath maps all 6 public marketing routes cleanly', () => {
  assert.equal(normalizeMarketingPath('/'), '/');
  assert.equal(normalizeMarketingPath(''), '/');
  assert.equal(normalizeMarketingPath('/features'), '/features');
  assert.equal(normalizeMarketingPath('/features/'), '/features');
  assert.equal(normalizeMarketingPath('/PRICING/'), '/pricing');
  assert.equal(normalizeMarketingPath('/about'), '/about');
  assert.equal(normalizeMarketingPath('/contact'), '/contact');
  assert.equal(normalizeMarketingPath('/download'), '/download');
});

test('normalizeMarketingPath falls back to homepage for unknown public paths', () => {
  assert.equal(normalizeMarketingPath('/nonexistent'), '/');
});

test('isMarketingRoutePath identifies known marketing routes only', () => {
  assert.equal(isMarketingRoutePath('/'), true);
  assert.equal(isMarketingRoutePath('/features'), true);
  assert.equal(isMarketingRoutePath('/download'), true);
  assert.equal(isMarketingRoutePath('/app/login'), false);
  assert.equal(isMarketingRoutePath('/app/dashboard'), false);
});

test('marketingPageTitle provides distinct titles per route', () => {
  const titles = new Set([
    marketingPageTitle('/'),
    marketingPageTitle('/features'),
    marketingPageTitle('/pricing'),
    marketingPageTitle('/about'),
    marketingPageTitle('/contact'),
    marketingPageTitle('/download'),
  ]);
  assert.equal(titles.size, 6);
});
