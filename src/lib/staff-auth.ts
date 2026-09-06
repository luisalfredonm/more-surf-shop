import { createClient } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

/**
 * Valida que la request venga de un usuario de staff.
 * El cliente manda `Authorization: Bearer <access_token>` (sesión de Supabase);
 * verificamos el token con el anon key y el rol contra `profiles` (RLS bypass
 * con service_role).
 */
const URL = import.meta.env.SUPABASE_URL ?? '';
const ANON = import.meta.env.SUPABASE_ANON_KEY ?? '';

export async function requireStaff(
  request: Request,
): Promise<{ userId: string; role: 'owner' | 'staff' } | null> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !URL || !ANON || ANON.includes('...')) return null;

  try {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data, error } = await anon.auth.getUser(token);
    if (error || !data.user) return null;

    const { data: prof } = await getSupabase()
      .from('profiles')
      .select('role, active')
      .eq('id', data.user.id)
      .maybeSingle();
    if (!prof || !prof.active) return null;
    return { userId: data.user.id, role: prof.role as 'owner' | 'staff' };
  } catch {
    return null;
  }
}
