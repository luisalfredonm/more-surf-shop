import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { requireStaff } from '@lib/staff-auth';
import { expectedCash, getShiftTotals, round2 } from '@lib/cash';

export const prerender = false;

/**
 * Cierra un turno de caja. Recalcula los totales en el server desde `payments`.
 * El empleado cierra el suyo; el dueño puede cerrar cualquiera.
 * Si hay diferencia (faltante/sobrante) se exige una nota.
 */

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const Schema = z.object({
  shift_id: z.string().uuid(),
  counted_cash: z.number().min(0).max(1_000_000),
  notes: z.string().trim().max(1000).nullish(),
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
  if (!parsed.success) return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 400);
  if (!isSupabaseConfigured()) {
    return json({ error: 'Supabase no está configurado.', code: 'not_configured' }, 503);
  }
  const d = parsed.data;
  const supabase = getSupabase();

  const { data: shift, error: sErr } = await supabase
    .from('cash_shifts')
    .select('id, profile_id, status, opening_float')
    .eq('id', d.shift_id)
    .maybeSingle();
  if (sErr) {
    console.error('[cash/close] load:', sErr.message);
    return json({ error: 'No se pudo cargar el turno.' }, 500);
  }
  if (!shift) return json({ error: 'Ese turno no existe.' }, 404);
  if (shift.profile_id !== staff.userId && staff.role !== 'owner') {
    return json({ error: 'Sólo podés cerrar tu propio turno.' }, 403);
  }
  if (shift.status !== 'open' && shift.status !== 'reopened') {
    return json({ error: `El turno ya está ${shift.status}.`, code: 'not_open' }, 409);
  }

  const totals = await getShiftTotals(supabase, shift.id);
  const expected = expectedCash(Number(shift.opening_float), totals);
  const counted = round2(d.counted_cash);
  const difference = round2(counted - expected);

  if (difference !== 0 && !(d.notes && d.notes.trim().length > 0)) {
    return json(
      {
        error: 'Hay diferencia en la caja. Agregá una nota explicando el faltante o sobrante.',
        code: 'note_required',
        expected_cash: expected,
        difference,
      },
      400,
    );
  }

  const { error: upErr } = await supabase
    .from('cash_shifts')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: staff.userId,
      expected_cash: expected,
      counted_cash: counted,
      difference,
      card_total: totals.card_total,
      notes: d.notes?.trim() || null,
    })
    .eq('id', shift.id);
  if (upErr) {
    console.error('[cash/close] update:', upErr.message);
    return json({ error: 'No se pudo cerrar el turno.' }, 500);
  }

  return json(
    {
      ok: true,
      expected_cash: expected,
      counted_cash: counted,
      difference,
      card_total: totals.card_total,
      cash_count: totals.cash_count,
      card_count: totals.card_count,
    },
    200,
  );
};
