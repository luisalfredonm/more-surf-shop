/**
 * Emails transaccionales vía Resend (REST, sin dependencia npm).
 * Se dispara al confirmarse una reserva (pago capturado). Resiliente:
 * nunca lanza, solo loguea. Guard contra doble envío con
 * bookings.confirmation_sent_at.
 */
import { getSupabase, isSupabaseConfigured } from './supabase';
import { BUSINESS, whatsappUrl } from './constants';

const RESEND_API_KEY = import.meta.env.RESEND_API_KEY ?? '';
const FROM_EMAIL = import.meta.env.FROM_EMAIL ?? 'hello@moresurfshop.com';
const ADMIN_EMAIL = import.meta.env.ADMIN_EMAIL ?? '';

export function isEmailConfigured(): boolean {
  return Boolean(RESEND_API_KEY && RESEND_API_KEY.startsWith('re_'));
}

async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });
  if (!res.ok) {
    console.error('[email] resend', res.status, (await res.text().catch(() => '')).slice(0, 300));
  }
}

interface EmailCtx {
  reference: string;
  className: string;
  dateLabel: string;
  timeLabel: string;
  people: number;
  amount: string;
  customerName: string;
  customerEmail: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;color:#6B7280;font-size:14px">${esc(label)}</td>
    <td style="padding:6px 0;color:#1F2937;font-size:14px;font-weight:600;text-align:right">${esc(value)}</td>
  </tr>`;
}

function customerHtml(c: EmailCtx): string {
  const wa = whatsappUrl(`Hola! Consulta sobre mi reserva ${c.reference}.`);
  return `<!doctype html><html><body style="margin:0;background:#F5EEE0;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px">
    <div style="background:#0A2540;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;font-family:Georgia,serif;font-size:18px;font-weight:600">
      more<span style="color:#14B8A6">surf</span>shop
    </div>
    <div style="background:#fff;padding:24px 22px;border-radius:0 0 12px 12px">
      <h1 style="margin:0 0 6px;font-family:Georgia,serif;font-size:20px;color:#0A2540">Tu lección está confirmada</h1>
      <p style="margin:0 0 18px;color:#6B7280;font-size:14px">Gracias ${esc(c.customerName)}. Te esperamos.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
        ${row('Código', c.reference)}
        ${row('Lección', c.className)}
        ${row('Fecha', c.dateLabel)}
        ${row('Hora', c.timeLabel)}
        ${row('Personas', String(c.people))}
        ${row('Pagado', c.amount)}
      </table>
      <p style="margin:0 0 6px;font-weight:600;color:#0A2540;font-size:14px">Qué llevar</p>
      <p style="margin:0 0 18px;color:#1F2937;font-size:14px">Traje de baño, protector solar reef-safe, toalla y buena onda. Tabla, licra e instructor van incluidos.</p>
      <p style="margin:0 0 4px;color:#6B7280;font-size:13px">${esc(BUSINESS.address.formatted)}</p>
      <p style="margin:0"><a href="${wa}" style="color:#0F9488;font-size:14px;font-weight:600">Escribinos por WhatsApp</a></p>
    </div>
    <p style="text-align:center;color:#6B7280;font-size:12px;margin-top:16px">
      ${esc(BUSINESS.name)} · ${esc(BUSINESS.address.locality)}, ${esc(BUSINESS.address.region)}, Costa Rica
    </p>
  </div></body></html>`;
}

function adminHtml(c: EmailCtx): string {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1F2937">
  <h2 style="font-size:16px;margin:0 0 12px">Nueva reserva confirmada — ${esc(c.reference)}</h2>
  <table style="border-collapse:collapse">
    ${row('Cliente', c.customerName)}
    ${row('Email', c.customerEmail)}
    ${row('Lección', c.className)}
    ${row('Fecha', c.dateLabel)}
    ${row('Hora', c.timeLabel)}
    ${row('Personas', String(c.people))}
    ${row('Monto', c.amount)}
  </table></body></html>`;
}

/**
 * Envía la confirmación al cliente y (si hay ADMIN_EMAIL) al admin.
 * Idempotente: marca bookings.confirmation_sent_at y no reenvía.
 */
export async function sendBookingConfirmationEmails(bookingId: string): Promise<void> {
  if (!isEmailConfigured() || !isSupabaseConfigured()) return;
  try {
    const supabase = getSupabase();
    const { data: b } = await supabase
      .from('bookings')
      .select(
        'id, reference, status, slot_date, start_time, participants_count, total_amount, currency, class_type_id, customer_id, confirmation_sent_at',
      )
      .eq('id', bookingId)
      .maybeSingle();
    if (!b || b.status !== 'confirmed' || b.confirmation_sent_at) return;

    // Marcar primero; si otra request llegó antes, afecta 0 filas y salimos.
    const { data: marked } = await supabase
      .from('bookings')
      .update({ confirmation_sent_at: new Date().toISOString() })
      .eq('id', bookingId)
      .is('confirmation_sent_at', null)
      .select('id');
    if (!marked || marked.length === 0) return;

    const [{ data: ct }, { data: cust }] = await Promise.all([
      supabase.from('class_types').select('name').eq('id', b.class_type_id).maybeSingle(),
      supabase.from('customers').select('full_name, email').eq('id', b.customer_id).maybeSingle(),
    ]);
    if (!cust?.email) return;

    const dateLabel = new Date(`${b.slot_date}T12:00:00`).toLocaleDateString('es-CR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    const ctx: EmailCtx = {
      reference: b.reference,
      className: ct?.name ?? 'Surf lesson',
      dateLabel,
      timeLabel: String(b.start_time).slice(0, 5),
      people: b.participants_count,
      amount: new Intl.NumberFormat('es-CR', {
        style: 'currency',
        currency: b.currency || 'USD',
      }).format(Number(b.total_amount)),
      customerName: cust.full_name || 'crack',
      customerEmail: cust.email,
    };

    await Promise.all([
      sendEmail({
        to: cust.email,
        subject: `Confirmada: tu lección de surf (${ctx.reference})`,
        html: customerHtml(ctx),
      }),
      ADMIN_EMAIL
        ? sendEmail({
            to: ADMIN_EMAIL,
            subject: `Nueva reserva confirmada — ${ctx.reference}`,
            html: adminHtml(ctx),
          })
        : Promise.resolve(),
    ]);
  } catch (e) {
    console.error('[email] sendBookingConfirmationEmails', e);
  }
}
