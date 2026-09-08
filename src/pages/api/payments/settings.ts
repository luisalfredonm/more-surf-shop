import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';
import { requireStaff } from '@lib/staff-auth';
import { clearPayPalConfigCache } from '@lib/paypal';

export const prerender = false;

/**
 * Configuración del proveedor de pago online (PayPal). Sólo el dueño.
 * GET  → estado actual SIN el secret (se devuelve has_secret: bool).
 * POST → guarda. El secret sólo se actualiza si viene con contenido.
 */

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const Schema = z.object({
  paypal_enabled: z.boolean(),
  paypal_env: z.enum(['sandbox', 'live']),
  paypal_client_id: z.string().trim().max(200).nullish(),
  paypal_webhook_id: z.string().trim().max(200).nullish(),
  paypal_secret: z.string().trim().max(400).optional(), // vacío/ausente = no cambiar
});

async function loadRow(supabase: ReturnType<typeof getSupabase>) {
  const { data } = await supabase
    .from('payment_settings')
    .select('paypal_enabled, paypal_env, paypal_client_id, paypal_secret, paypal_webhook_id, updated_at')
    .eq('id', 1)
    .maybeSingle();
  return data;
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await requireStaff(request);
  if (!staff) return json({ error: 'unauthorized' }, 401);
  if (staff.role !== 'owner') return json({ error: 'Sólo el dueño.', code: 'forbidden' }, 403);
  if (!isSupabaseConfigured()) return json({ error: 'not_configured' }, 503);

  const row = await loadRow(getSupabase());
  return json({
    ok: true,
    paypal_enabled: !!row?.paypal_enabled,
    paypal_env: (row?.paypal_env as 'sandbox' | 'live') ?? 'sandbox',
    paypal_client_id: row?.paypal_client_id ?? '',
    paypal_webhook_id: row?.paypal_webhook_id ?? '',
    has_secret: !!(row?.paypal_secret && String(row.paypal_secret).length > 0),
    updated_at: row?.updated_at ?? null,
  });
};

export const POST: APIRoute = async ({ request }) => {
  const staff = await requireStaff(request);
  if (!staff) return json({ error: 'unauthorized' }, 401);
  if (staff.role !== 'owner') return json({ error: 'Sólo el dueño.', code: 'forbidden' }, 403);
  if (!isSupabaseConfigured()) return json({ error: 'not_configured' }, 503);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'Expected JSON body' }, 400);
  }
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) return json({ error: 'Validation failed', issues: parsed.error.flatten() }, 400);
  const d = parsed.data;
  const supabase = getSupabase();

  const patch: Record<string, unknown> = {
    id: 1,
    paypal_enabled: d.paypal_enabled,
    paypal_env: d.paypal_env,
    paypal_client_id: d.paypal_client_id?.trim() || null,
    paypal_webhook_id: d.paypal_webhook_id?.trim() || null,
  };
  if (d.paypal_secret && d.paypal_secret.trim().length > 0) {
    patch.paypal_secret = d.paypal_secret.trim();
  }

  const { error } = await supabase.from('payment_settings').upsert(patch, { onConflict: 'id' });
  if (error) {
    console.error('[payments/settings] save:', error.message);
    return json({ error: 'No se pudo guardar la configuración.' }, 500);
  }

  clearPayPalConfigCache();

  // Aviso si se activó PayPal sin credenciales completas.
  const row = await loadRow(supabase);
  const ready = !!(row?.paypal_client_id && row?.paypal_secret);
  return json({ ok: true, enabled: d.paypal_enabled, ready, has_secret: !!row?.paypal_secret });
};
