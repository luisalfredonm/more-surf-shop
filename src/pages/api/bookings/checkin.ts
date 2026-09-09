import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { requireStaff } from '@lib/staff-auth';
import { renderWaiverText, WAIVER_VERSION } from '@lib/waiver';

export const prerender = false;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

/**
 * Una persona del check-in. Adulto: firma por sí mismo. Menor (is_minor):
 * firma su adulto responsable, cuyo nombre va en guardian_name.
 */
const PersonSchema = z
  .object({
    full_name: z.string().trim().min(2).max(120),
    is_minor: z.boolean(),
    guardian_name: z.string().trim().min(2).max(120).nullish(),
    emergency_contact_name: z.string().trim().max(120).nullish(),
    emergency_contact_phone: z.string().trim().max(40).nullish(),
    accepted_terms: z.literal(true),
    signature_svg: z.string().max(200_000).nullish(),
  })
  .refine((p) => !p.is_minor || (p.guardian_name?.length ?? 0) >= 2, {
    message: 'guardian_name is required for a minor',
    path: ['guardian_name'],
  });

const Schema = z.object({
  booking_id: z.string().uuid(),
  force: z.boolean().optional(),
  participants: z.array(PersonSchema).min(1).max(20),
});

export const POST: APIRoute = async ({ request }) => {
  const staff = await requireStaff(request);
  if (!staff) return json({ error: 'unauthorized' }, 401);

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
  if (!isSupabaseConfigured()) {
    return json({ error: 'Supabase is not configured.', code: 'not_configured' }, 503);
  }

  const { booking_id, participants, force } = parsed.data;
  const supabase = getSupabase();

  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select('id, reference, customer_id, checked_in_at')
    .eq('id', booking_id)
    .maybeSingle();
  if (bErr) {
    console.error('[bookings/checkin] load:', bErr.message);
    return json({ error: 'Could not load the booking' }, 500);
  }
  if (!booking) return json({ error: 'That booking does not exist.' }, 404);
  if (booking.checked_in_at && !force) {
    return json(
      {
        error: 'This booking is already checked in. Reload the agenda to see the waivers.',
        code: 'already_checked_in',
      },
      409,
    );
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    null;
  const userAgent = request.headers.get('user-agent')?.slice(0, 400) ?? null;
  const signedAtISO = new Date().toISOString();

  let count = 0;
  for (const p of participants) {
    const signerName = p.is_minor ? (p.guardian_name as string) : p.full_name;

    const { data: part, error: pErr } = await supabase
      .from('booking_participants')
      .insert({
        booking_id: booking.id,
        full_name: p.full_name,
        is_minor: p.is_minor,
        emergency_contact_name: p.emergency_contact_name ?? null,
        emergency_contact_phone: p.emergency_contact_phone ?? null,
      })
      .select('id')
      .single();
    if (pErr || !part) {
      console.error('[bookings/checkin] participant:', pErr?.message);
      return json({ error: 'Could not save a participant.', checked_in: count }, 500);
    }

    const snapshot = renderWaiverText({
      activity: 'surf lessons',
      signerName,
      signedAtISO,
      isMinor: p.is_minor,
      guardianName: p.is_minor ? (p.guardian_name as string) : null,
      minorName: p.is_minor ? p.full_name : null,
    });

    const { data: waiver, error: wErr } = await supabase
      .from('waivers')
      .insert({
        customer_id: booking.customer_id,
        booking_participant_id: part.id,
        waiver_version: WAIVER_VERSION,
        activity: 'lesson',
        signed_at: signedAtISO,
        signer_name_typed: signerName,
        accepted_terms: true,
        is_minor: p.is_minor,
        guardian_name: p.is_minor ? (p.guardian_name as string) : null,
        ip,
        user_agent: userAgent,
        rendered_text_snapshot: snapshot,
        signature_svg: p.signature_svg ?? null,
        lang: 'en',
      })
      .select('id')
      .single();
    if (wErr || !waiver) {
      console.error('[bookings/checkin] waiver:', wErr?.message);
      return json({ error: 'Could not save a waiver.', checked_in: count }, 500);
    }

    await supabase.from('booking_participants').update({ waiver_id: waiver.id }).eq('id', part.id);
    count++;
  }

  const { error: ciErr } = await supabase
    .from('bookings')
    .update({ checked_in_at: signedAtISO, checked_in_by: staff.userId })
    .eq('id', booking.id);
  if (ciErr) console.error('[bookings/checkin] stamp:', ciErr.message);

  return json({ ok: true, checked_in: count, reference: booking.reference }, 200);
};
