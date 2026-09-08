import type { APIRoute } from 'astro';
import { isSupabaseConfigured } from '@lib/supabase';
import { requireStaff } from '@lib/staff-auth';
import { testCredentials } from '@lib/paypal';

export const prerender = false;

/** Prueba las credenciales PayPal guardadas (OAuth token). Sólo el dueño. */

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const staff = await requireStaff(request);
  if (!staff) return json({ error: 'unauthorized' }, 401);
  if (staff.role !== 'owner') return json({ error: 'Sólo el dueño.', code: 'forbidden' }, 403);
  if (!isSupabaseConfigured()) return json({ error: 'not_configured' }, 503);

  const result = await testCredentials();
  return json(result);
};
