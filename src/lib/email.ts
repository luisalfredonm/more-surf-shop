/**
 * Emails transaccionales vía Resend (REST, sin dependencia npm).
 * Se dispara al confirmarse un booking_group (pago capturado, o reserva
 * "pagar al llegar"). Resiliente: nunca lanza, solo loguea. Guard contra
 * doble envío con booking_groups.confirmation_sent_at.
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
    body: JSON.stringify({ from: FROM_EMAIL, to: [opts.to], subject: opts.subject, html: opts.html }),
  });
  if (!res.ok) {
    console.error('[email] resend', res.status, (await res.text().catch(() => '')).slice(0, 300));
  }
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

const money = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('es-CR', { style: 'currency', currency }).format(n);

const dateLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('es-CR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

function kvRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;color:#6B7280;font-size:14px">${esc(label)}</td>
    <td style="padding:6px 0;color:#1F2937;font-size:14px;font-weight:600;text-align:right">${esc(value)}</td>
  </tr>`;
}

interface Item {
  class_name: string;
  slot_date: string;
  start_time: string;
  participants_count: number;
  total_amount: number;
}
interface GroupCtx {
  reference: string;
  items: Item[];
  total: number;
  currency: string;
  paid: boolean; // true = ya pagó (PayPal); false = paga al llegar
  customerName: string;
  customerEmail: string;
}

function itemLines(c: GroupCtx): string {
  return c.items
    .map(
      (it) => `<tr>
        <td style="padding:8px 0;border-top:1px solid #E5DECD;font-size:14px;color:#1F2937">
          <strong>${esc(it.class_name)}</strong><br>
          <span style="color:#6B7280">${esc(dateLabel(it.slot_date))} · ${esc(it.start_time.slice(0, 5))} · ${it.participants_count} pers</span>
        </td>
        <td style="padding:8px 0;border-top:1px solid #E5DECD;font-size:14px;font-weight:600;text-align:right;color:#1F2937">
          ${esc(money(it.total_amount, c.currency))}
        </td>
      </tr>`,
    )
    .join('');
}

function customerHtml(c: GroupCtx): string {
  const wa = whatsappUrl(`Hola! Consulta sobre mi reserva ${c.reference}.`);
  const payLine = c.paid
    ? `Pagado: <strong>${esc(money(c.total, c.currency))}</strong>`
    : `Pagás al llegar: <strong>${esc(money(c.total, c.currency))}</strong> — traé efectivo o tarjeta.`;
  return `<!doctype html><html><body style="margin:0;background:#F5EEE0;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:540px;margin:0 auto;padding:24px 16px">
    <div style="background:#0A2540;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;font-family:Georgia,serif;font-size:18px;font-weight:600">
      more<span style="color:#14B8A6">surf</span>shop
    </div>
    <div style="background:#fff;padding:24px 22px;border-radius:0 0 12px 12px">
      <h1 style="margin:0 0 6px;font-family:Georgia,serif;font-size:20px;color:#0A2540">Reserva confirmada</h1>
      <p style="margin:0 0 4px;color:#6B7280;font-size:14px">Gracias ${esc(c.customerName)}. Tu código:</p>
      <p style="margin:0 0 18px;font-family:Georgia,serif;font-size:22px;font-weight:600;color:#0A2540;letter-spacing:.04em">${esc(c.reference)}</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
        ${itemLines(c)}
        <tr>
          <td style="padding:10px 0;border-top:2px solid #0A2540;font-size:14px;color:#6B7280">Total</td>
          <td style="padding:10px 0;border-top:2px solid #0A2540;font-size:16px;font-weight:700;text-align:right;color:#0A2540">${esc(money(c.total, c.currency))}</td>
        </tr>
      </table>
      <p style="margin:0 0 16px;padding:10px 14px;background:#FDF6E3;border-left:3px solid #F97316;font-size:14px;color:#1F2937">${payLine}</p>
      <p style="margin:0 0 6px;font-weight:600;color:#0A2540;font-size:14px">Antes de la clase</p>
      <ul style="margin:0 0 16px;padding-left:18px;color:#1F2937;font-size:14px;line-height:1.6">
        <li>Llegá 15 minutos antes a la tienda.</li>
        <li>Vas a firmar el waiver (release of liability) en el mostrador.</li>
        <li>Traé traje de baño, protector solar reef-safe y toalla. Tabla, licra e instructor van incluidos.</li>
      </ul>
      <p style="margin:0 0 4px;color:#6B7280;font-size:13px">${esc(BUSINESS.address.formatted)}</p>
      <p style="margin:0"><a href="${wa}" style="color:#0F9488;font-size:14px;font-weight:600">Escribinos por WhatsApp</a></p>
    </div>
    <p style="text-align:center;color:#6B7280;font-size:12px;margin-top:16px">
      ${esc(BUSINESS.name)} · ${esc(BUSINESS.address.locality)}, ${esc(BUSINESS.address.region)}, Costa Rica
    </p>
  </div></body></html>`;
}

function adminHtml(c: GroupCtx): string {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1F2937">
  <h2 style="font-size:16px;margin:0 0 12px">Reserva confirmada — ${esc(c.reference)} ${c.paid ? '(pagada)' : '(paga al llegar)'}</h2>
  <table style="border-collapse:collapse;margin-bottom:12px">
    ${kvRow('Cliente', c.customerName)}
    ${kvRow('Email', c.customerEmail)}
    ${kvRow('Total', money(c.total, c.currency))}
  </table>
  <table style="width:100%;max-width:480px;border-collapse:collapse">${itemLines(c)}</table>
  </body></html>`;
}

/**
 * Envía la confirmación del grupo al cliente y (si hay ADMIN_EMAIL) al admin.
 * Idempotente vía booking_groups.confirmation_sent_at.
 */
export async function sendBookingGroupEmails(groupId: string): Promise<void> {
  if (!isEmailConfigured() || !isSupabaseConfigured()) return;
  try {
    const supabase = getSupabase();
    const { data: g } = await supabase
      .from('booking_groups')
      .select('id, reference, status, total_amount, currency, payment_method, customer_id, confirmation_sent_at')
      .eq('id', groupId)
      .maybeSingle();
    if (!g || g.status !== 'confirmed' || g.confirmation_sent_at) return;

    const { data: marked } = await supabase
      .from('booking_groups')
      .update({ confirmation_sent_at: new Date().toISOString() })
      .eq('id', groupId)
      .is('confirmation_sent_at', null)
      .select('id');
    if (!marked || marked.length === 0) return;

    const [{ data: cust }, { data: bookings }] = await Promise.all([
      supabase.from('customers').select('full_name, email').eq('id', g.customer_id).maybeSingle(),
      supabase
        .from('bookings')
        .select('slot_date, start_time, participants_count, total_amount, class_types(name)')
        .eq('group_id', groupId)
        .order('slot_date'),
    ]);
    if (!cust?.email) return;

    const items: Item[] = (bookings ?? []).map((b: any) => ({
      class_name: (Array.isArray(b.class_types) ? b.class_types[0]?.name : b.class_types?.name) ?? 'Surf lesson',
      slot_date: b.slot_date,
      start_time: String(b.start_time),
      participants_count: b.participants_count,
      total_amount: Number(b.total_amount),
    }));

    const ctx: GroupCtx = {
      reference: g.reference,
      items,
      total: Number(g.total_amount),
      currency: g.currency || 'USD',
      paid: g.payment_method === 'paypal',
      customerName: cust.full_name || 'crack',
      customerEmail: cust.email,
    };

    await Promise.all([
      sendEmail({
        to: cust.email,
        subject: `Reserva confirmada — ${ctx.reference}`,
        html: customerHtml(ctx),
      }),
      ADMIN_EMAIL
        ? sendEmail({
            to: ADMIN_EMAIL,
            subject: `Reserva ${ctx.paid ? 'pagada' : 'confirmada'} — ${ctx.reference}`,
            html: adminHtml(ctx),
          })
        : Promise.resolve(),
    ]);
  } catch (e) {
    console.error('[email] sendBookingGroupEmails', e);
  }
}
