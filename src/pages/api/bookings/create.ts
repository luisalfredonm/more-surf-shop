import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { getAvailableSlots, PENDING_HOLD_MINUTES } from '@lib/queries/availability';

export const prerender = false;

const ParticipantSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  age: z.number().int().min(0).max(120).nullish(),
  experience_level: z
    .enum(['first_time', 'beginner', 'intermediate', 'advanced'])
    .nullish(),
  weight_kg: z.number().min(20).max(250).nullish(),
  height_cm: z.number().min(80).max(230).nullish(),
  notes: z.string().max(500).nullish(),
});

const BookingSchema = z.object({
  class_type_id: z.string().uuid(),
  slot_id: z.string().uuid(),
  participants: z.array(ParticipantSchema).min(1).max(20),
  contact: z.object({
    full_name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(200),
    phone: z.string().max(40).nullish(),
    country_of_residence: z.string().max(80).nullish(),
  }),
  customer_note: z.string().max(1000).nullish(),
  source: z.enum(['web', 'walk_in', 'whatsapp', 'phone']).default('web'),
  website: z.string().max(200).optional(), // honeypot: debe venir vacío (se chequea abajo)
});

// Alfabeto sin caracteres ambiguos (I, O, 0, 1).
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  let s = '';
  for (const b of bytes) s += REF_ALPHABET[b % REF_ALPHABET.length];
  return `MSS-${s}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'Expected JSON body' }, 400);
  }

  const parsed = BookingSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 400);
  }
  const data = parsed.data;

  // Honeypot: si trae contenido, fingir éxito y no hacer nada.
  if (data.website && data.website.length > 0) {
    return json({ ok: true, reference: 'MSS-XXXXX' }, 200);
  }

  if (!isSupabaseConfigured()) {
    return json(
      {
        error: 'Las reservas en línea todavía no están activas. Escríbenos por WhatsApp.',
        code: 'not_configured',
      },
      503,
    );
  }

  const supabase = getSupabase();

  // 1. Slot válido
  const { data: slot, error: slotErr } = await supabase
    .from('lesson_slots')
    .select('id, slot_date, start_time, status, class_type_id')
    .eq('id', data.slot_id)
    .maybeSingle();
  if (slotErr) {
    console.error('[bookings/create] slot fetch:', slotErr.message);
    return json({ error: 'No se pudo verificar el horario' }, 500);
  }
  if (!slot) return json({ error: 'Ese horario ya no existe.', code: 'slot_missing' }, 409);
  if (slot.status !== 'open') {
    return json({ error: 'Ese horario está cerrado.', code: 'slot_closed' }, 409);
  }
  if (slot.class_type_id !== data.class_type_id) {
    return json(
      { error: 'El horario no corresponde a ese tipo de clase.', code: 'mismatch' },
      409,
    );
  }

  // 2. Clase activa
  const { data: ct, error: ctErr } = await supabase
    .from('class_types')
    .select('id, name, price_per_person, active')
    .eq('id', data.class_type_id)
    .maybeSingle();
  if (ctErr) {
    console.error('[bookings/create] class_type fetch:', ctErr.message);
    return json({ error: 'No se pudo verificar el tipo de clase' }, 500);
  }
  if (!ct || !ct.active) {
    return json(
      { error: 'Ese tipo de clase no está disponible.', code: 'class_inactive' },
      409,
    );
  }

  // 3. Recheck de cupo (guard de carrera): la disponibilidad pudo cambiar
  //    entre que el cliente cargó el UI y envió la reserva.
  const avail = await getAvailableSlots({
    from: slot.slot_date,
    to: slot.slot_date,
    classTypeId: data.class_type_id,
  });
  const thisSlot = avail.find((s) => s.slot_id === data.slot_id);
  if (!thisSlot) {
    return json(
      {
        error: 'Ese horario ya no está disponible (cerrado, pasado o lleno).',
        code: 'slot_unavailable',
      },
      409,
    );
  }
  const count = data.participants.length;
  if (thisSlot.remaining < count) {
    return json(
      {
        error: `Quedan ${thisSlot.remaining} cupo(s) en ese horario.`,
        code: 'slot_full',
        remaining: thisSlot.remaining,
      },
      409,
    );
  }

  // 4. Precio
  const unitPrice = Number(ct.price_per_person);
  if (data.source === 'web' && !(unitPrice > 0)) {
    return json(
      {
        error:
          'Ese tipo de clase todavía no tiene precio configurado. Escríbenos por WhatsApp.',
        code: 'no_price',
      },
      409,
    );
  }
  const total = Math.round(unitPrice * count * 100) / 100;

  // 5. Cliente: buscar o crear por email (siempre en minúsculas)
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
    const { data: created, error: createErr } = await supabase
      .from('customers')
      .insert({
        full_name: data.contact.full_name,
        email,
        phone: data.contact.phone ?? null,
        country_of_residence: data.contact.country_of_residence ?? null,
      })
      .select('id')
      .single();
    if (createErr || !created) {
      console.error('[bookings/create] customer create:', createErr?.message);
      return json({ error: 'No se pudo crear el cliente' }, 500);
    }
    customerId = created.id;
  }

  // 6. Booking — 1 reintento si choca el `reference`
  let bookingId: string | null = null;
  let reference = '';
  for (let attempt = 0; attempt < 2 && !bookingId; attempt++) {
    reference = makeReference();
    const { data: b, error: bErr } = await supabase
      .from('bookings')
      .insert({
        reference,
        customer_id: customerId,
        class_type_id: data.class_type_id,
        slot_id: data.slot_id,
        slot_date: slot.slot_date,
        start_time: slot.start_time,
        participants_count: count,
        unit_price: unitPrice,
        total_amount: total,
        currency: 'USD',
        status: 'pending_payment',
        source: data.source,
        customer_note: data.customer_note ?? null,
      })
      .select('id')
      .single();
    if (bErr) {
      if ((bErr as { code?: string }).code === '23505' && attempt === 0) continue;
      console.error('[bookings/create] booking insert:', bErr.message);
      return json({ error: 'No se pudo crear la reserva' }, 500);
    }
    bookingId = b.id;
  }
  if (!bookingId) return json({ error: 'No se pudo crear la reserva' }, 500);

  // 7. Participantes — rollback best-effort si falla (no hay transacción en supabase-js)
  const { error: pErr } = await supabase.from('booking_participants').insert(
    data.participants.map((p) => ({
      booking_id: bookingId,
      full_name: p.full_name,
      age: p.age ?? null,
      is_minor: p.age != null && p.age < 18,
      weight_kg: p.weight_kg ?? null,
      height_cm: p.height_cm ?? null,
      experience_level: p.experience_level ?? null,
      notes: p.notes ?? null,
    })),
  );
  if (pErr) {
    console.error('[bookings/create] participants insert:', pErr.message);
    await supabase.from('bookings').delete().eq('id', bookingId);
    return json({ error: 'No se pudo guardar los participantes' }, 500);
  }

  return json(
    {
      ok: true,
      reference,
      booking_id: bookingId,
      amount: total,
      currency: 'USD',
      hold_minutes: PENDING_HOLD_MINUTES,
      // Próximo: firmar waiver (rebanada 5) y pagar con PayPal (rebanada 4).
      next: 'waiver_then_payment',
    },
    201,
  );
};
