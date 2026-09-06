import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getAvailableSlots } from '@lib/queries/availability';
import { rateLimit, clientKey, tooMany } from '@lib/ratelimit';

export const prerender = false;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 45;

const QuerySchema = z.object({
  from: z.string().regex(DATE_RE),
  to: z.string().regex(DATE_RE),
  classTypeId: z.string().uuid().optional(),
  minLeadHours: z.coerce.number().int().min(0).max(72).optional(),
});

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Fecha calendario actual en Costa Rica (UTC-6 fijo, sin horario de verano). */
function costaRicaToday(): string {
  return new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
}

export const GET: APIRoute = async ({ url, request }) => {
  if (!rateLimit(`av:${clientKey(request)}`, 120, 60_000)) return tooMany();

  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return json({ error: 'Invalid query', issues: parsed.error.flatten() }, 400);
  }

  const { from, to, classTypeId, minLeadHours } = parsed.data;

  const span = daysBetween(from, to);
  if (span < 0) return json({ error: '"to" must not be before "from"' }, 400);
  if (span > MAX_RANGE_DAYS) {
    return json({ error: `Date range too wide (max ${MAX_RANGE_DAYS} days)` }, 400);
  }

  const today = costaRicaToday();
  const effectiveFrom = from < today ? today : from;
  if (to < today) {
    return json({ slots: [] }, 200, { 'Cache-Control': 'no-store' });
  }

  try {
    const slots = await getAvailableSlots({
      from: effectiveFrom,
      to,
      classTypeId: classTypeId ?? null,
      minLeadHours,
    });
    return json({ slots }, 200, { 'Cache-Control': 'no-store' });
  } catch (err) {
    console.error('[api/availability] error:', err);
    return json({ error: 'Could not load availability' }, 500);
  }
};
