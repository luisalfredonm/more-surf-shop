import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { requireStaff } from '@lib/staff-auth';
import { getOpenShift, round2 } from '@lib/cash';

export const prerender = false;

/** Abre un turno de caja para el empleado logueado. Uno por empleado a la vez. */

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const Schema = z.object({
  opening_float: z.number().min(0).max(1_000_000),
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
  const supabase = getSupabase();

  const existing = await getOpenShift(supabase, staff.userId);
  if (existing) {
    return json({ error: 'Ya tenés un turno abierto.', code: 'already_open', shift_id: existing.id }, 409);
  }

  const { data, error } = await supabase
    .from('cash_shifts')
    .insert({ profile_id: staff.userId, opening_float: round2(parsed.data.opening_float) })
    .select('id, opened_at, opening_float')
    .single();
  if (error || !data) {
    // 23505 = carrera con el índice único de "un turno abierto".
    if ((error as { code?: string })?.code === '23505') {
      return json({ error: 'Ya tenés un turno abierto.', code: 'already_open' }, 409);
    }
    console.error('[cash/open]', error?.message);
    return json({ error: 'No se pudo abrir el turno.' }, 500);
  }

  return json({ ok: true, shift: data }, 201);
};
