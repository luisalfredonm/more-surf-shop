import type { APIRoute } from 'astro';
import { seoData } from '@lib/seo';
import { absoluteUrl } from '@lib/constants';
import { getCatalogUnits, RENTAL_CATEGORIES } from '@lib/queries/rentals';

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

  // Catálogo de alquiler: categorías con flota + la ficha de cada tabla.
  const rentalUrls: string[] = [];
  if (seoData['surfboard-rental-tamarindo'] && !seoData['surfboard-rental-tamarindo'].noindex) {
    const units = await getCatalogUnits();
    const cats = new Set(units.map((u) => u.category));
    for (const c of RENTAL_CATEGORIES) {
      if (cats.has(c.slug)) rentalUrls.push(entry(`/surfboard-rental-tamarindo/${c.slug}`, '0.6'));
    }
    for (const u of units) {
      rentalUrls.push(entry(`/surfboard-rental-tamarindo/board/${u.slug}`, '0.5'));
    }
  }

  const urls = [...staticUrls, ...rentalUrls].join('\n');

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
