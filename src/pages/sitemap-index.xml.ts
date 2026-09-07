import type { APIRoute } from 'astro';
import { seoData } from '@lib/seo';
import { absoluteUrl } from '@lib/constants';
import { getBoardModels, RENTAL_CATEGORIES } from '@lib/queries/rentals';

export const prerender = false;

/**
 * Sitemap dinámico generado a partir de seoData + las páginas de categoría de
 * rental que tengan flota cargada. Excluye páginas marcadas con noindex.
 */
export const GET: APIRoute = async () => {
  const today = new Date().toISOString().split('T')[0];

  const entry = (slug: string, priority = '0.8') => `  <url>
    <loc>${absoluteUrl(slug)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;

  const staticUrls = Object.values(seoData)
    .filter((page) => !page.noindex)
    .map((page) => entry(page.slug, page.slug === '/' ? '1.0' : '0.8'));

  // Categorías de rental con al menos un modelo con unidades.
  const catUrls: string[] = [];
  if (seoData['surfboard-rental-tamarindo'] && !seoData['surfboard-rental-tamarindo'].noindex) {
    const results = await Promise.all(
      RENTAL_CATEGORIES.map(async (c) => ({ c, has: (await getBoardModels(c.slug)).length > 0 })),
    );
    for (const { c, has } of results) {
      if (has) catUrls.push(entry(`/surfboard-rental-tamarindo/${c.slug}`, '0.6'));
    }
  }

  const urls = [...staticUrls, ...catUrls].join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
};
