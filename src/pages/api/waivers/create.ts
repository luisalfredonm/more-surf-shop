import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { WAIVER_VERSION, renderWaiverText } from '@lib/waiver';

export const prerender = false;

const WaiverSchema = z
  .object({
    booking_id: z.string().uuid(),
    signer_name_typed: z.string().trim().min(2).max(120),
    accepted_terms: z.literal(true),
    waiver_version: z.string().max(40),
    is_minor: z.boolean().default(false),
    guardian_name: z.string().trim().max(120).nullish(),
    activity: z.enum(['lesson', 'rental', 'both']).default('lesson'),
  })
  .refine((d) => !d.is_minor || (d.guardian_name?.trim().length ?? 0) >= 2, {
    message: 'guardian_name required when is_minor is true',
    path: ['guardian_name'],
  });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clientIp(request: Request): string | null {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() || null;
  return request.headers.get('x-real-ip');
}

export const POST: APIRoute = async ({ request }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'Expected JSON body' }, 400);
  }

  const parsed = WaiverSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 400);
  }
  const data = parsed.data;

  if (data.waiver_version !== WAIVER_VERSION) {
    return json(
      {
        error: 'El waiver se actualizó. Revisá la versión nueva y volvé a aceptarla.',
        code: 'version_mismatch',
        current: WAIVER_VERSION,
      },
      409,
    );
  }

  if (!isSupabaseConfigured()) {
    return json(
      { error: 'El registro del waiver todavía no está activo.', code: 'not_configured' },
      503,
    );
  }

  const supabase = getSupabase();

  // 1. Booking válido
  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select('id, customer_id, status, class_type_id, waiver_id')
    .eq('id', data.booking_id)
    .maybeSingle();
  if (bErr) {
    console.error('[waivers/create] booking fetch:', bErr.message);
    return json({ error: 'No se pudo verificar la reserva' }, 500);
  }
  if (!booking) return json({ error: 'Esa reserva no existe.', code: 'booking_missing' }, 404);
  if (booking.status === 'cancelled') {
    return json({ error: 'Esa reserva está cancelada.', code: 'booking_cancelled' }, 409);
  }
  if (booking.waiver_id) {
    // Ya firmado: idempotente para tolerar doble envío.
    return json({ ok: true, waiver_id: booking.waiver_id, already: true }, 200);
  }

  // 2. Nombre de la actividad para el texto
  const { data: ct } = await supabase
    .from('class_types')
    .select('name')
    .eq('id', booking.class_type_id)
    .maybeSingle();
  const activityLabel = ct?.name || 'Surf Lessons';

  // 3. Render + insert
  const signedAtISO = new Date().toISOString();
  const rendered = renderWaiverText({
    activity: activityLabel,
    signerName: data.signer_name_typed,
    signedAtISO,
    isMinor: data.is_minor,
    guardianName: data.guardian_name ?? null,
  });

  const { data: waiver, error: wErr } = await supabase
    .from('waivers')
    .insert({
      customer_id: booking.customer_id,
      waiver_version: WAIVER_VERSION,
      activity: data.activity,
      signer_name_typed: data.signer_name_typed,
      accepted_terms: true,
      is_minor: data.is_minor,
      guardian_name: data.is_minor ? (data.guardian_name ?? null) : null,
      ip: clientIp(request),
      user_agent: request.headers.get('user-agent'),
      rendered_text_snapshot: rendered,
    })
    .select('id')
    .single();
  if (wErr || !waiver) {
    console.error('[waivers/create] insert:', wErr?.message);
    return json({ error: 'No se pudo registrar el waiver' }, 500);
  }

  // 4. Enlazar al booking
  const { error: linkErr } = await supabase
    .from('bookings')
    .update({ waiver_id: waiver.id })
    .eq('id', booking.id);
  if (linkErr) {
    console.error('[waivers/create] link:', linkErr.message);
    // El waiver quedó guardado; el staff puede enlazarlo a mano si hace falta.
  }

  return json({ ok: true, waiver_id: waiver.id }, 201);
};
