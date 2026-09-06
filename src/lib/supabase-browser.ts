import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase para el browser (panel de staff en /staff).
 * Usa el anon key + la sesión del usuario autenticado; RLS (is_staff())
 * es la frontera de seguridad. Nunca usar el service_role en el cliente.
 */

const URL = import.meta.env.PUBLIC_SUPABASE_URL ?? '';
const ANON = import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '';

export function browserSupabaseConfigured(): boolean {
  return Boolean(URL && ANON && !URL.includes('xxxx') && !ANON.includes('...'));
}

let client: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(URL, ANON, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}
