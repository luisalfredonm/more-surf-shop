import type { APIRoute } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { getAvailableSlots, PENDING_HOLD_MINUTES } from '@lib/queries/availability';
import { sendBookingGroupEmails } from '@lib/email';

export const prerender = false;

const ItemSchema = z.object({
  class_type_id: z.string().uuid(),
  slot_id: z.string().uuid(),
  guests: z.number().int().min(1).max(20),
});

const CreateSchema = z.object({
  items: z.array(ItemSchema).min(1).max(10),
  contact: z.object({
    full_name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(200),
    phone: z.string().max(40).nullish(),
    country_of_residence: z.string().max(80).nullish(),
  }),
  payment_method: z.enum(['paypal', 'on_arrival']),
  customer_note: z.string().max(1000).nullish(),
  source: z.enum(['web', 'walk_in', 'whatsapp', 'phone']).default('web'),
  website: z.string().max(200).optional(), // honeypot
});

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeRef(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  let s = '';
  for (const b of bytes) s += REF_ALPHABET[b % REF_ALPHABET.length];
  return `${prefix}-${s}`;
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

interface PricedItem {
  class_type_id: string;
  slot_id: string;
  guests: number;
  slot_date: string;
  start_time: string;
  class_name: string;
  unit_price: number;
  line_total: number;
}

export const POST: APIRoute = async ({ request }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'Expected JSON body' }, 400);
  }
  const parsed = CreateSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 400);
  }
  const data = parsed.data;

  if (data.website && data.website.length > 0) {
    return json({ ok: true, group_reference: 'GRP-XXXXX' }, 200);
  }
  if (!isSupabaseConfigured()) {
    return json(
      { error: 'Las reservas en línea todavía no están activas. Escribinos por WhatsApp.', code: 'not_configured' },
      503,
    );
  }

  const supabase = getSupabase();

  // --- Validar y tasar cada ítem ---
  const priced: PricedItem[] = [];
  const usedBySlot = new Map<string, number>(); // cupo consumido dentro de este mismo carrito

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];

    const { data: slot, error: slotErr } = await supabase
      .from('lesson_slots')
      .select('id, slot_date, start_time, status, class_type_id')
      .eq('id', item.slot_id)
      .maybeSingle();
    if (slotErr) {
      console.error('[bookings/create] slot:', slotErr.message);
      return json({ error: 'No se pudo verificar un horario' }, 500);
    }
    if (!slot) return json({ error: 'Un horario ya no existe.', code: 'slot_missing', item: i }, 409);
    if (slot.status !== 'open') {
      return json({ error: 'Un horario está cerrado.', code: 'slot_closed', item: i }, 409);
    }
    if (slot.class_type_id !== item.class_type_id) {
      return json({ error: 'Horario y tipo de clase no coinciden.', code: 'mismatch', item: i }, 409);
    }

    const { data: ct, error: ctErr } = await supabase
      .from('class_types')
      .select('id, name, price_per_person, active, min_guests, max_guests')
      .eq('id', item.class_type_id)
      .maybeSingle();
    if (ctErr) {
      console.error('[bookings/create] class_type:', ctErr.message);
      return json({ error: 'No se pudo verificar un tipo de clase' }, 500);
    }
    if (!ct || !ct.active) {
      return json({ error: 'Un tipo de clase no está disponible.', code: 'class_inactive', item: i }, 409);
    }

    // Cupo restante (guard de carrera) menos lo que ya consumió el carrito.
    const avail = await getAvailableSlots({
      from: slot.slot_date,
      to: slot.slot_date,
      classTypeId: item.class_type_id,
    });
    const thisSlot = avail.find((s) => s.slot_id === item.slot_id);
    const alreadyInCart = usedBySlot.get(item.slot_id) ?? 0;
    if (!thisSlot) {
      return json(
        { error: 'Un horario ya no está disponible (cerrado, pasado o lleno).', code: 'slot_unavailable', item: i },
        409,
      );
    }
    if (thisSlot.remaining - alreadyInCart < item.guests) {
      return json(
        {
          error: `Quedan ${thisSlot.remaining - alreadyInCart} cupo(s) en un horario.`,
          code: 'slot_full',
          item: i,
          remaining: thisSlot.remaining - alreadyInCart,
        },
        409,
      );
    }
    usedBySlot.set(item.slot_id, alreadyInCart + item.guests);

    const maxGuests = ct.max_guests ?? thisSlot.capacity_total;
    if (item.guests < (ct.min_guests ?? 1) || item.guests > maxGuests) {
      return json(
        {
          error: `Ese tipo de clase admite de ${ct.min_guests ?? 1} a ${maxGuests} personas.`,
          code: 'guest_bounds',
          item: i,
        },
        409,
      );
    }

    const unit = Number(ct.price_per_person);
    if (data.source === 'web' && !(unit > 0)) {
      return json(
        { error: 'Un tipo de clase todavía no tiene precio configurado. Escribinos por WhatsApp.', code: 'no_price', item: i },
        409,
      );
    }

    priced.push({
      class_type_id: item.class_type_id,
      slot_id: item.slot_id,
      guests: item.guests,
      slot_date: slot.slot_date,
      start_time: slot.start_time,
      class_name: ct.name,
      unit_price: unit,
      line_total: Math.round(unit * item.guests * 100) / 100,
    });
  }

  const groupTotal = Math.round(priced.reduce((s, p) => s + p.line_total, 0) * 100) / 100;

  // --- Cliente: buscar o crear por email ---
  const email = data.contact.email.toLowerCase();
  let customerId: string;
  const { data: existing, error: findErr } = await supabase
    .from('customers')
    .select('id')
    .eq('email', email)
    .limit(1)
    .maybeSingle();
  if (findErr) {
    console.error('[bookings/create] customer find:', findErr.message);
    return json({ error: 'No se pudo procesar el cliente' }, 500);
  }
  if (existing) {
    customerId = existing.id;
    await supabase
      .from('customers')
      .update({
        full_name: data.contact.full_name,
        phone: data.contact.phone ?? undefined,
        country_of_residence: data.contact.country_of_residence ?? undefined,
      })
      .eq('id', customerId);
  } else {
    const { data: created, error: cErr } = await supabase
      .from('customers')
      .insert({
        full_name: data.contact.full_name,
        email,
        phone: data.contact.phone ?? null,
        country_of_residence: data.contact.country_of_residence ?? null,
      })
      .select('id')
      .single();
    if (cErr || !created) {
      console.error('[bookings/create] customer create:', cErr?.message);
      return json({ error: 'No se pudo crear el cliente' }, 500);
    }
    customerId = created.id;
  }

  // --- Grupo ---
  const onArrival = data.payment_method === 'on_arrival';
  let group: { id: string; reference: string } | null = null;
  for (let attempt = 0; attempt < 2 && !group; attempt++) {
    const reference = makeRef('GRP');
    const { data: g, error: gErr } = await supabase
      .from('booking_groups')
      .insert({
        reference,
        customer_id: customerId,
        total_amount: groupTotal,
        currency: 'USD',
        payment_method: data.payment_method,
        status: 'pending',
      })
      .select('id, reference')
      .single();
    if (gErr) {
      if ((gErr as { code?: string }).code === '23505' && attempt === 0) continue;
      console.error('[bookings/create] group:', gErr.message);
      return json({ error: 'No se pudo crear la reserva' }, 500);
    }
    group = g;
  }
  if (!group) return json({ error: 'No se pudo crear la reserva' }, 500);

  // --- Reservas ---
  const rows = priced.map((p) => ({
    reference: makeRef('MSS'),
    group_id: group!.id,
    customer_id: customerId,
    class_type_id: p.class_type_id,
    slot_id: p.slot_id,
    slot_date: p.slot_date,
    start_time: p.start_time,
    participants_count: p.guests,
    unit_price: p.unit_price,
    total_amount: p.line_total,
    currency: 'USD',
    status: onArrival ? 'confirmed' : 'pending_payment',
    payment_method: data.payment_method,
    source: data.source,
    customer_note: data.customer_note ?? null,
  }));

  const { data: inserted, error: bErr } = await supabase
    .from('bookings')
    .insert(rows)
    .select('reference');
  if (bErr || !inserted) {
    console.error('[bookings/create] bookings:', bErr?.message);
    await rollback(supabase, group.id);
    return json({ error: 'No se pudo crear la reserva' }, 500);
  }
  const references = inserted.map((r) => r.reference);

  if (onArrival) {
    await supabase.from('booking_groups').update({ status: 'confirmed' }).eq('id', group.id);
    await sendBookingGroupEmails(group.id);
    return json(
      {
        ok: true,
        group_id: group.id,
        group_reference: group.reference,
        references,
        total: groupTotal,
        currency: 'USD',
        payment_method: 'on_arrival',
        confirmed: true,
      },
      201,
    );
  }

  return json(
    {
      ok: true,
      group_id: group.id,
      group_reference: group.reference,
      references,
      total: groupTotal,
      currency: 'USD',
      payment_method: 'paypal',
      hold_minutes: PENDING_HOLD_MINUTES,
    },
    201,
  );
};

async function rollback(supabase: SupabaseClient, groupId: string): Promise<void> {
  await supabase.from('bookings').delete().eq('group_id', groupId);
  await supabase.from('booking_groups').delete().eq('id', groupId);
}
