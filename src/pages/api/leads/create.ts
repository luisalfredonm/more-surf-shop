import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from '@lib/supabase';

export const prerender = false;

const LeadSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(200),
  phone: z.string().max(40).optional().nullable(),
  country: z.string().max(80).optional().nullable(),
  interest: z.enum(['private', 'semi-private', 'group', 'family', 'general']),
  preferred_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  party_size: z.number().int().min(1).max(20).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  source_page: z.string().max(200).default('/'),
  website: z.string().max(0).optional(), // honeypot: debe estar vacío
});

export const POST: APIRoute = async ({ request }) => {
  try {
    // Aceptar tanto JSON como form-urlencoded
    let body: unknown;
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      const formData = await request.formData();
      body = Object.fromEntries(formData);
      // Convertir party_size a número si viene como string
      if ((body as any).party_size) {
        (body as any).party_size = Number((body as any).party_size);
      }
    }

    const parsed = LeadSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({
          error: 'Validation failed',
          issues: parsed.error.flatten(),
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Rechazo silencioso si el honeypot tiene contenido (bots)
    if (parsed.data.website && parsed.data.website.length > 0) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Si Supabase no está configurado, log a consola y devolver ok
    // (útil en desarrollo antes de tener credenciales)
    if (!isSupabaseConfigured()) {
      console.log('[leads/create] Lead recibido (Supabase no configurado):', parsed.data);
      return new Response(JSON.stringify({ ok: true, dev: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('leads')
      .insert({
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone || null,
        country: parsed.data.country || null,
        interest: parsed.data.interest,
        preferred_date: parsed.data.preferred_date || null,
        party_size: parsed.data.party_size || null,
        notes: parsed.data.notes || null,
        source_page: parsed.data.source_page,
        status: 'new',
      })
      .select('id')
      .single();

    if (error) {
      console.error('[leads/create] Supabase error:', error.message);
      return new Response(
        JSON.stringify({ error: 'Could not save lead' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // TODO: enviar email transaccional (Resend) al admin y confirmación al lead
    // Ver /src/lib/emailService.ts (por implementar en fase 2)

    return new Response(JSON.stringify({ ok: true, id: data.id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[leads/create] Unexpected error:', err);
    return new Response(
      JSON.stringify({ error: 'Unexpected server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
