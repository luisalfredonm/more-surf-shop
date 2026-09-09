import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { rateLimit, clientKey, tooMany } from '@lib/ratelimit';

export const prerender = false;

const Schema = z.object({
  reference: z
    .string()
    .trim()
    .regex(/^GRP-[A-Za-z0-9]{5}$/)
    .transform((s) => s.toUpperCase()),
  email: z.string().trim().email().max(200),
});

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const one = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
const timeLabel = (t: string) => {
  const [h, m] = String(t).split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};
const dtLabel = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
const RATE_LABEL: Record<string, [string, string]> = {
  hour: ['hour', 'hours'],
  day: ['day', 'days'],
  week: ['week', 'weeks'],
};

export const POST: APIRoute = async ({ request }) => {
  if (!rateLimit(`lk:${clientKey(request)}`, 10, 60_000)) return tooMany();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'Expected JSON body' }, 400);
  }
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) return json({ error: 'Check the code and the email.' }, 400);
  if (!isSupabaseConfigured()) return json({ error: 'No disponible.' }, 503);

  const supabase = getSupabase();
  const { data: g } = await supabase
    .from('booking_groups')
    .select(
      `reference, status, payment_method, total_amount, currency,
       customers ( email ),
       bookings ( slot_date, start_time, participants_count, status, payment_id, class_types ( name ) ),
       rentals ( start_at, end_at, units_billed, rate_type, status, payment_id, board_models ( name ) )`,
    )
    .eq('reference', parsed.data.reference)
    .maybeSingle();

  const custEmail = (one(g?.customers) as { email?: string } | null)?.email ?? '';
  if (!g || custEmail.toLowerCase() !== parsed.data.email.toLowerCase()) {
    return json({ error: 'We could not find that booking.' }, 404);
  }

  const bookings = (g.bookings ?? []) as any[];
  const rentals = (g.rentals ?? []) as any[];
  const lines = [...bookings, ...rentals];
  const paid =
    g.payment_method === 'paypal' ||
    (lines.length > 0 && lines.every((x) => x.payment_id));

  const items = [
    ...bookings.map((b) => ({
      kind: 'lesson' as const,
      title: (one(b.class_types) as { name?: string } | null)?.name ?? 'Surf lesson',
      detail: `${dayLabel(b.slot_date)} · ${timeLabel(b.start_time)} · ${b.participants_count} guests`,
      status: b.status,
    })),
    ...rentals.map((r) => {
      const [uOne, uMany] = RATE_LABEL[r.rate_type as string] ?? ['', ''];
      return {
        kind: 'rental' as const,
        title: (one(r.board_models) as { name?: string } | null)?.name ?? 'Board rental',
        detail: `${dtLabel(r.start_at)} → ${dtLabel(r.end_at)} · ${r.units_billed} ${r.units_billed === 1 ? uOne : uMany}`,
        status: r.status,
      };
    }),
  ];

  return json({
    ok: true,
    reference: g.reference,
    status: g.status,
    payment_method: g.payment_method,
    paid,
    total: Number(g.total_amount),
    currency: g.currency || 'USD',
    items,
  });
};
