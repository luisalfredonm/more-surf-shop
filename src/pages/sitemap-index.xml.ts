import type { APIRoute } from 'astro';
import { seoData } from '@lib/seo';
import { absoluteUrl } from '@lib/constants';

export const prerender = false;

/**
 * Sitemap dinámico generado a partir de seoData.
 * Excluye páginas marcadas con noindex.
 */
export const GET: APIRoute = async () => {
  const today = new Date().toISOString().split('T')[0];

  const urls = Object.values(seoData)
    .filter((page) => !page.noindex)
    .map((page) => {
      const loc = absoluteUrl(page.slug);
      const priority = page.slug === '/' ? '1.0' : '0.8';
      return `  <url>
    <loc>${loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
    })
    .join('\n');

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
