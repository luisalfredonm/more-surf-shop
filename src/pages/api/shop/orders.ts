import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { rateLimit, clientKey, tooMany } from '@lib/ratelimit';

export const prerender = false;

/**
 * Orden online de la tienda — "retirá en tienda". Sin envíos.
 *
 * El precio y la disponibilidad los pone el SERVER (los lee de la variante y de
 * shop_variant_available): el cliente sólo manda qué variante y cuántas.
 *
 * Estados al crearse:
 *   paypal    -> 'pending_payment'  (retiene stock 20 min; el capture la pasa a 'paid')
 *   on_pickup -> 'reserved'         (retiene stock 48 h; se cobra en el mostrador)
 *
 * No baja stock: eso pasa recién cuando la orden llega a 'picked_up'.
 */

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const Schema = z.object({
  items: z
    .array(
      z.object({
        variant_id: z.string().uuid(),
        qty: z.number().int().min(1).max(20),
      }),
    )
    .min(1)
    .max(20),
  contact: z.object({
    full_name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(200),
    phone: z.string().trim().max(40).nullish(),
  }),
  payment_method: z.enum(['paypal', 'on_pickup']),
  customer_note: z.string().trim().max(1000).nullish(),
  website: z.string().max(200).optional(), // honeypot
});

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeRef(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  let s = '';
  for (const b of bytes) s += REF_ALPHABET[b % REF_ALPHABET.length];
  return `${prefix}-${s}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

interface PricedLine {
  variant_id: string;
  name_snapshot: string;
  sku_snapshot: string;
  unit_price: number;
  qty: number;
  line_total: number;
}

export const POST: APIRoute = async ({ request }) => {
  if (!rateLimit(`shop:${clientKey(request)}`, 10, 10 * 60_000)) return tooMany();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'Expected JSON body' }, 400);
  }
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;
  if (d.website && d.website.length > 0) {
    return json({ ok: true, reference: 'ORD-XXXXX' }, 200); // bot
  }
  if (!isSupabaseConfigured()) {
    return json(
      { error: 'The online shop is not live yet. Message us on WhatsApp.', code: 'not_configured' },
      503,
    );
  }

  const supabase = getSupabase();

  // --- Tasar y validar cada línea contra la base ---
  const lines: PricedLine[] = [];
  const seen = new Set<string>();
  for (const item of d.items) {
    if (seen.has(item.variant_id)) continue; // misma variante repetida
    seen.add(item.variant_id);

    const { data: v } = await supabase
      .from('product_variants')
      .select('id, sku, label, price_override, active, products ( name, price, active )')
      .eq('id', item.variant_id)
      .maybeSingle();
    const p = v ? (Array.isArray(v.products) ? v.products[0] : v.products) : null;
    if (!v || !v.active || !p || !p.active) {
      return json(
        { error: 'One of the items is no longer available.', code: 'item_unavailable' },
        409,
      );
    }

    const unitPrice = Number(v.price_override ?? p.price) || 0;
    if (!(unitPrice > 0)) {
      return json(
        { error: `"${p.name}" has no price yet. Message us on WhatsApp.`, code: 'no_price' },
        409,
      );
    }

    const { data: available, error: aErr } = await supabase.rpc('shop_variant_available', {
      p_variant_id: item.variant_id,
    });
    if (aErr) {
      console.error('[shop/orders] availability:', aErr.message);
      return json({ error: "Couldn't check availability." }, 500);
    }
    const free = Number(available) || 0;
    if (free < item.qty) {
      return json(
        {
          error:
            free <= 0
              ? `"${p.name}" just sold out.`
              : `Only ${free} left of "${p.name}". Adjust the quantity.`,
          code: 'not_enough_stock',
          variant_id: item.variant_id,
          available: free,
        },
        409,
      );
    }

    lines.push({
      variant_id: v.id,
      name_snapshot: v.label === 'Único' ? p.name : `${p.name} — ${v.label}`,
      sku_snapshot: v.sku,
      unit_price: unitPrice,
      qty: item.qty,
      line_total: round2(unitPrice * item.qty),
    });
  }

  const total = round2(lines.reduce((s, l) => s + l.line_total, 0));
  if (!(total > 0)) return json({ error: 'Empty order.', code: 'empty' }, 409);

  // --- Cliente (find-or-create por email) ---
  const email = d.contact.email.toLowerCase();
  let customerId: string;
  const { data: existing } = await supabase
    .from('customers')
    .select('id')
    .eq('email', email)
    .limit(1)
    .maybeSingle();
  if (existing) {
    customerId = existing.id;
    await supabase
      .from('customers')
      .update({ full_name: d.contact.full_name, phone: d.contact.phone ?? undefined })
      .eq('id', customerId);
  } else {
    const { data: created, error: cErr } = await supabase
      .from('customers')
      .insert({ full_name: d.contact.full_name, email, phone: d.contact.phone ?? null })
      .select('id')
      .single();
    if (cErr || !created) {
      console.error('[shop/orders] customer:', cErr?.message);
      return json({ error: "Couldn't process the customer." }, 500);
    }
    customerId = created.id;
  }

  // --- Orden ---
  const isPaypal = d.payment_method === 'paypal';
  let order: { id: string; reference: string } | null = null;
  for (let attempt = 0; attempt < 2 && !order; attempt++) {
    const reference = makeRef('ORD');
    const { data: o, error: oErr } = await supabase
      .from('orders')
      .insert({
        reference,
        channel: 'online',
        customer_id: customerId,
        status: isPaypal ? 'pending_payment' : 'reserved',
        subtotal: total,
        total,
        currency: 'USD',
        customer_note: d.customer_note?.trim() || null,
      })
      .select('id, reference')
      .single();
    if (oErr) {
      if ((oErr as { code?: string }).code === '23505' && attempt === 0) continue; // ref repetida
      console.error('[shop/orders] order:', oErr.message);
      return json({ error: "Couldn't create the order." }, 500);
    }
    order = o;
  }
  if (!order) return json({ error: "Couldn't create the order." }, 500);

  const { error: iErr } = await supabase.from('order_items').insert(
    lines.map((l) => ({ order_id: order!.id, ...l })),
  );
  if (iErr) {
    console.error('[shop/orders] items:', iErr.message);
    // Sin líneas la orden no sirve y retendría stock: se borra (cascade).
    await supabase.from('orders').delete().eq('id', order.id);
    return json({ error: "Couldn't create the order." }, 500);
  }

  return json(
    {
      ok: true,
      order_id: order.id,
      reference: order.reference,
      total,
      currency: 'USD',
      payment_method: d.payment_method,
      status: isPaypal ? 'pending_payment' : 'reserved',
    },
    201,
  );
};
