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

export const POST: APIRoute = async ({ request }) => {
  if (!rateLimit(`lk:${clientKey(request)}`, 10, 60_000)) return tooMany();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'Expected JSON body' }, 400);
  }
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) return json({ error: 'Revisá el código y el email.' }, 400);
  if (!isSupabaseConfigured()) return json({ error: 'No disponible.' }, 503);

  const supabase = getSupabase();
  const { data: g } = await supabase
    .from('booking_groups')
    .select(
      `reference, status, payment_method, total_amount, currency,
       customers ( email ),
       bookings ( slot_date, start_time, participants_count, status, payment_id, class_types ( name ) )`,
    )
    .eq('reference', parsed.data.reference)
    .maybeSingle();

  const custEmail = (one(g?.customers) as { email?: string } | null)?.email ?? '';
  if (!g || custEmail.toLowerCase() !== parsed.data.email.toLowerCase()) {
    return json({ error: 'No encontramos esa reserva.' }, 404);
  }

  const bookings = (g.bookings ?? []) as any[];
  const paid =
    g.payment_method === 'paypal' ||
    (bookings.length > 0 && bookings.every((b) => b.payment_id));

  return json({
    ok: true,
    reference: g.reference,
    status: g.status,
    payment_method: g.payment_method,
    paid,
    total: Number(g.total_amount),
    currency: g.currency || 'USD',
    items: bookings.map((b) => ({
      class_name: (one(b.class_types) as { name?: string } | null)?.name ?? 'Surf lesson',
      slot_date: b.slot_date,
      start_time: String(b.start_time),
      guests: b.participants_count,
      status: b.status,
    })),
  });
};
