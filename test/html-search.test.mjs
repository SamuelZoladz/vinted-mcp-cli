import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePolishCatalog } from '../dist/client/html-search.js';
import { searchItems } from '../dist/client/endpoints.js';

test('Polish catalogue fallback extracts item price, not buyer-protection total', () => {
  const html = `<div data-testid="product-item-id-123"><img src="https://images.vinted.net/example.webp"/><a data-testid="product-item-id-123--overlay-link" href="/items/123-nike" title="Nike &amp; hoodie, Marka: Nike, Stan: Bardzo dobry, Rozmiar: M, 25.00 zł, 29.15 zł"></a></div>`;
  const result = parsePolishCatalog(html, 3);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'Nike & hoodie');
  assert.deepEqual(result.items[0].price, { amount: '25.00', currency_code: 'PLN' });
  assert.equal(result.items[0].size_title, 'M');
  assert.equal(result.items[0].brand_title, 'Nike');
  assert.equal(result.items[0].url, 'https://www.vinted.pl/items/123-nike');
});

test('Unrecognized catalogue fails explicitly rather than reporting no listings', () => {
  assert.throws(() => parsePolishCatalog('<html>Access denied</html>', 3), /no recognizable/);
});

const noSizeCard = `<div data-testid="product-item-id-456"><a data-testid="product-item-id-456--overlay-link" href="/items/456-mat" title="Camping mat, Stan: Nowy bez metki, 1 234,50 zł, 1 299,50 zł"></a></div>`;

test('Missing brand and size do not leak metadata into the title or lose condition', () => {
  const { items } = parsePolishCatalog(noSizeCard, 1);
  assert.equal(items[0].title, 'Camping mat');
  assert.equal(items[0].status, 'Nowy bez metki');
  assert.equal(items[0].price.amount, '1234.50');
});

test('Polish API 404 falls back with filters and discloses unavailable totals', async () => {
  let catalogUrl;
  const client = {
    apiGet: async () => { throw new Error('Vinted 404 for https://www.vinted.pl/api/v2/catalog/items'); },
    fetchHtml: async (url) => { catalogUrl = new URL(url); return { status: 200, body: noSizeCard }; },
  };
  const result = await searchItems(client, { query: 'camping mat', country: 'pl', priceMax: 250, sizeIds: [3], condition: ['good'], page: 2 });
  assert.equal(catalogUrl.pathname, '/catalog');
  assert.equal(catalogUrl.searchParams.get('search_text'), 'camping mat');
  assert.equal(catalogUrl.searchParams.get('price_to'), '250');
  assert.equal(catalogUrl.searchParams.get('size_ids'), '3');
  assert.equal(catalogUrl.searchParams.get('status_ids'), '3');
  assert.equal(catalogUrl.searchParams.get('page'), '2');
  assert.equal(result.items[0].id, 456);
  assert.equal(result.source, 'html-catalog');
  assert.equal(result.totalCountIsExact, false);
  assert.equal(result.page, 2);
});

test('Fallback does not mask authentication errors or run on other countries', async () => {
  for (const [country, message] of [['pl', 'Vinted 403 for URL'], ['fr', 'Vinted 404 for URL']]) {
    await assert.rejects(searchItems({
      apiGet: async () => { throw new Error(message); },
      fetchHtml: async () => { assert.fail('must not fetch HTML'); },
    }, { query: 'x', country }), { message });
  }
});

test('Fallback rejects date filters instead of silently ignoring them', async () => {
  await assert.rejects(searchItems({
    apiGet: async () => { throw new Error('Vinted 404 for URL'); },
    fetchHtml: async () => { assert.fail('must not fetch HTML'); },
  }, { query: 'x', country: 'pl', dateFrom: '2026-10-01' }), /Date filters are not supported/);
});
