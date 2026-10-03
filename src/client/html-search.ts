import { load } from 'cheerio';
import type { SearchParams } from './types.js';
import type { VintedClient } from './session.js';

// The Polish JSON search endpoint currently returns 404. Use the public
// server-rendered catalogue, retaining the same search/filter query parameters.
export async function searchPolishCatalog(client: VintedClient, apiPath: string, params: SearchParams) {
  if (params.dateFrom || params.dateTo) throw new Error('Date filters are not supported by the HTML catalogue fallback');
  const url = `https://www.vinted.pl/catalog?${apiPath.split('?')[1]}`;
  const { status, body } = await client.fetchHtml(url);
  if (status !== 200) throw new Error(`Vinted catalogue returned ${status}`);
  return parsePolishCatalog(body, Math.min(params.perPage ?? 20, 100));
}

export function parsePolishCatalog(body: string, limit: number) {
  const $ = load(body);
  const items: any[] = [];
  $('[data-testid]').filter((_, el) => /^product-item-id-\d+$/.test($(el).attr('data-testid') ?? '')).each((_, el) => {
    const card = $(el);
    const link = card.find('a[data-testid$="--overlay-link"]').first();
    const href = link.attr('href');
    const id = Number(href?.match(/\/items\/(\d+)/)?.[1]);
    if (!id || !href) return;
    const text = link.attr('title') ?? card.find('img').attr('alt') ?? '';
    const price = text.match(/(?:^|,\s*)([\d\s]+[.,]\d{2})\s*zł(?:,|$)/)?.[1]?.replace(/\s/g, '').replace(',', '.');
    if (!price) throw new Error(`Cannot parse catalogue price for item ${id}`);
    items.push({
      id,
      title: text.split(/, (?:Marka|Stan|Rozmiar):/)[0],
      price: { amount: price, currency_code: 'PLN' },
      brand_title: text.match(/, Marka: (.*?)(?=, (?:Stan|Rozmiar):|, [\d\s]+[.,]\d{2}\s*zł)/s)?.[1],
      status: text.match(/, Stan: (.*?)(?=, Rozmiar:|, [\d\s]+[.,]\d{2}\s*zł)/s)?.[1],
      size_title: text.match(/, Rozmiar: (.*?), [\d\s]+[.,]\d{2}\s*zł/)?.[1],
      url: new URL(href, 'https://www.vinted.pl').href,
      photo: { url: card.find('img').first().attr('src') },
      favourite_count: Number(card.find('[data-testid="favourite-count-text"]').text()) || 0,
    });
  });
  if (!items.length && !$('[data-testid="catalog-empty-state"]').length && !/Nie znaleźliśmy|Nie znaleziono|Brak wyników/i.test($.text())) {
    throw new Error('Vinted catalogue has no recognizable listing cards; HTML layout or access may have changed');
  }
  // The HTML page does not expose a reliable total across all pages.
  return { items: items.slice(0, limit), pagination: undefined };
}
