/**
 * Emails transaccionales vía Resend (REST, sin dependencia npm).
 * Se dispara al confirmarse un booking_group (pago capturado, o reserva
 * "pagar al llegar"). Resiliente: nunca lanza, solo loguea. Guard contra
 * doble envío con booking_groups.confirmation_sent_at.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from './supabase';
import { BUSINESS, SITE, whatsappUrl } from './constants';

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

const dtLabel = (iso: string) =>
  new Date(iso).toLocaleString('es-CR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const RATE_ES: Record<string, [string, string]> = {
  hour: ['hora', 'horas'],
  day: ['día', 'días'],
  week: ['semana', 'semanas'],
};

function kvRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;color:#6B7280;font-size:14px">${esc(label)}</td>
    <td style="padding:6px 0;color:#1F2937;font-size:14px;font-weight:600;text-align:right">${esc(value)}</td>
  </tr>`;
}

interface Item {
  title: string;
  detail: string;
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
          <strong>${esc(it.title)}</strong><br>
          <span style="color:#6B7280">${esc(it.detail)}</span>
        </td>
        <td style="padding:8px 0;border-top:1px solid #E5DECD;font-size:14px;font-weight:600;text-align:right;color:#1F2937">
          ${esc(money(it.total_amount, c.currency))}
        </td>
      </tr>`,
    )
    .join('');
}

/** Líneas de un grupo (lecciones + alquileres) en el shape común de Item. */
async function groupItems(supabase: SupabaseClient, groupId: string): Promise<Item[]> {
  const [{ data: bookings }, { data: rentals }] = await Promise.all([
    supabase
      .from('bookings')
      .select('slot_date, start_time, participants_count, total_amount, class_types(name)')
      .eq('group_id', groupId)
      .order('slot_date'),
    supabase
      .from('rentals')
      .select('start_at, end_at, units_billed, rate_type, total_amount, board_models(name)')
      .eq('group_id', groupId)
      .order('start_at'),
  ]);

  const lessons: Item[] = (bookings ?? []).map((b: any) => ({
    title:
      (Array.isArray(b.class_types) ? b.class_types[0]?.name : b.class_types?.name) ?? 'Surf lesson',
    detail: `${dateLabel(b.slot_date)} · ${String(b.start_time).slice(0, 5)} · ${b.participants_count} pers`,
    total_amount: Number(b.total_amount),
  }));

  const boards: Item[] = (rentals ?? []).map((r: any) => {
    const [one, many] = RATE_ES[r.rate_type as string] ?? ['', ''];
    return {
      title:
        (Array.isArray(r.board_models) ? r.board_models[0]?.name : r.board_models?.name) ??
        'Alquiler de tabla',
      detail: `${dtLabel(r.start_at)} → ${dtLabel(r.end_at)} · ${r.units_billed} ${r.units_billed === 1 ? one : many}`,
      total_amount: Number(r.total_amount),
    };
  });

  return [...lessons, ...boards];
}

/** true = el grupo ya está pagado (PayPal, o todas las líneas con payment_id). */
async function groupIsPaid(
  supabase: SupabaseClient,
  groupId: string,
  paymentMethod: string | null,
): Promise<boolean> {
  if (paymentMethod === 'paypal') return true;
  const [{ data: b }, { data: r }] = await Promise.all([
    supabase.from('bookings').select('payment_id').eq('group_id', groupId),
    supabase.from('rentals').select('payment_id').eq('group_id', groupId),
  ]);
  const lines = [...(b ?? []), ...(r ?? [])];
  return lines.length > 0 && lines.every((x: any) => x.payment_id);
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
      <p style="margin:0 0 4px"><a href="${SITE.url}/booking" style="color:#0F9488;font-size:14px;font-weight:600">Ver tu reserva online</a></p>
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

function reminderHtml(c: GroupCtx): string {
  const wa = whatsappUrl(`Hola! Consulta sobre mi reserva ${c.reference}.`);
  const payLine = c.paid
    ? `Ya está pagado (${esc(money(c.total, c.currency))}).`
    : `Pagás <strong>${esc(money(c.total, c.currency))}</strong> al llegar — efectivo o tarjeta.`;
  return `<!doctype html><html><body style="margin:0;background:#F5EEE0;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:540px;margin:0 auto;padding:24px 16px">
    <div style="background:#0A2540;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;font-family:Georgia,serif;font-size:18px;font-weight:600">
      more<span style="color:#14B8A6">surf</span>shop
    </div>
    <div style="background:#fff;padding:24px 22px;border-radius:0 0 12px 12px">
      <h1 style="margin:0 0 6px;font-family:Georgia,serif;font-size:20px;color:#0A2540">Tu lección de surf es pronto</h1>
      <p style="margin:0 0 4px;color:#6B7280;font-size:14px">Recordatorio, ${esc(c.customerName)}. Código:</p>
      <p style="margin:0 0 16px;font-family:Georgia,serif;font-size:22px;font-weight:600;color:#0A2540;letter-spacing:.04em">${esc(c.reference)}</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px">${itemLines(c)}</table>
      <p style="margin:0 0 16px;padding:10px 14px;background:#FDF6E3;border-left:3px solid #F97316;font-size:14px;color:#1F2937">${payLine}</p>
      <ul style="margin:0 0 16px;padding-left:18px;color:#1F2937;font-size:14px;line-height:1.6">
        <li>Llegá 15 minutos antes a la tienda.</li>
        <li>Firmás el waiver en el mostrador.</li>
        <li>Traé traje de baño, protector solar reef-safe y toalla.</li>
      </ul>
      <p style="margin:0 0 4px;color:#6B7280;font-size:13px">${esc(BUSINESS.address.formatted)}</p>
      <p style="margin:0"><a href="${wa}" style="color:#0F9488;font-size:14px;font-weight:600">Necesitás reprogramar? Escribinos</a></p>
    </div>
  </div></body></html>`;
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

    const [{ data: cust }, items] = await Promise.all([
      supabase.from('customers').select('full_name, email').eq('id', g.customer_id).maybeSingle(),
      groupItems(supabase, groupId),
    ]);
    if (!cust?.email) return;

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

/**
 * Recordatorio al cliente ~24h antes. Idempotente vía reminder_sent_at.
 */
export async function sendBookingGroupReminder(groupId: string): Promise<void> {
  if (!isEmailConfigured() || !isSupabaseConfigured()) return;
  try {
    const supabase = getSupabase();
    const { data: g } = await supabase
      .from('booking_groups')
      .select('id, reference, status, total_amount, currency, payment_method, customer_id, reminder_sent_at')
      .eq('id', groupId)
      .maybeSingle();
    if (!g || g.status !== 'confirmed' || g.reminder_sent_at) return;

    const { data: marked } = await supabase
      .from('booking_groups')
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq('id', groupId)
      .is('reminder_sent_at', null)
      .select('id');
    if (!marked || marked.length === 0) return;

    const [{ data: cust }, items, paid] = await Promise.all([
      supabase.from('customers').select('full_name, email').eq('id', g.customer_id).maybeSingle(),
      groupItems(supabase, groupId),
      groupIsPaid(supabase, groupId, g.payment_method),
    ]);
    if (!cust?.email) return;

    const ctx: GroupCtx = {
      reference: g.reference,
      items,
      total: Number(g.total_amount),
      currency: g.currency || 'USD',
      paid,
      customerName: cust.full_name || 'crack',
      customerEmail: cust.email,
    };
    await sendEmail({
      to: cust.email,
      subject: `Recordatorio: tu lección de surf — ${ctx.reference}`,
      html: reminderHtml(ctx),
    });
  } catch (e) {
    console.error('[email] sendBookingGroupReminder', e);
  }
}

/**
 * Busca grupos confirmados con una lección ~10–34h en el futuro (hora CR)
 * sin recordatorio enviado, y les manda el recordatorio. Lo llama el cron.
 */
export async function sendDueReminders(): Promise<{ processed: number }> {
  if (!isEmailConfigured() || !isSupabaseConfigured()) return { processed: 0 };
  const supabase = getSupabase();
  const crMs = Date.now() - 6 * 3_600_000;
  const today = new Date(crMs).toISOString().slice(0, 10);
  const in3 = new Date(crMs + 3 * 86_400_000).toISOString().slice(0, 10);

  const { data } = await supabase
    .from('bookings')
    .select('group_id, slot_date, start_time')
    .eq('status', 'confirmed')
    .gte('slot_date', today)
    .lte('slot_date', in3)
    .not('group_id', 'is', null);

  const nowMs = Date.now();
  const due = new Set<string>();
  for (const b of data ?? []) {
    const instant =
      Date.parse(`${b.slot_date}T${String(b.start_time).slice(0, 5)}:00Z`) + 6 * 3_600_000;
    const hrs = (instant - nowMs) / 3_600_000;
    if (hrs >= 10 && hrs <= 34 && b.group_id) due.add(b.group_id as string);
  }

  for (const gid of due) {
    await sendBookingGroupReminder(gid);
  }
  return { processed: due.size };
}

// ============================================
// Rentals — recordatorio de retiro + aviso de devolución vencida
// ============================================

const dtFull = (iso: string) =>
  new Date(iso).toLocaleString('es-CR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

interface RentalCtx {
  reference: string; // GRP-XXXXX
  rentalRef: string; // RNT-XXXXX
  customerName: string;
  board: string; // "Longboard 9'0 #6.2 Ap"
  startAt: string;
  endAt: string;
  total: number;
  currency: string;
  paid: boolean;
}

function rentalShell(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#F5EEE0;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:540px;margin:0 auto;padding:24px 16px">
    <div style="background:#0A2540;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;font-family:Georgia,serif;font-size:18px;font-weight:600">
      more<span style="color:#14B8A6">surf</span>shop
    </div>
    <div style="background:#fff;padding:24px 22px;border-radius:0 0 12px 12px">
      <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:20px;color:#0A2540">${esc(title)}</h1>
      ${body}
    </div>
  </div></body></html>`;
}

function rentalReminderHtml(c: RentalCtx): string {
  const wa = whatsappUrl(`Hola! Consulta sobre mi alquiler ${c.reference}.`);
  const payLine = c.paid
    ? `Ya está pagado (${esc(money(c.total, c.currency))}).`
    : `Pagás <strong>${esc(money(c.total, c.currency))}</strong> al retirar — efectivo o tarjeta.`;
  return rentalShell(
    'Tu tabla te espera',
    `<p style="margin:0 0 4px;color:#6B7280;font-size:14px">Recordatorio, ${esc(c.customerName)}. Código:</p>
     <p style="margin:0 0 14px;font-family:Georgia,serif;font-size:22px;font-weight:600;color:#0A2540;letter-spacing:.04em">${esc(c.reference)}</p>
     <p style="margin:0 0 6px;font-size:14px;color:#1F2937"><strong>${esc(c.board)}</strong></p>
     <p style="margin:0 0 14px;font-size:14px;color:#6B7280">Retiro: ${esc(dtFull(c.startAt))} · devolución: ${esc(dtFull(c.endAt))}</p>
     <p style="margin:0 0 16px;padding:10px 14px;background:#FDF6E3;border-left:3px solid #F97316;font-size:14px;color:#1F2937">${payLine}</p>
     <ul style="margin:0 0 16px;padding-left:18px;color:#1F2937;font-size:14px;line-height:1.6">
       <li>Traé un documento con foto y una tarjeta para el depósito.</li>
       <li>Firmás el waiver de alquiler en el mostrador.</li>
       <li>Quillas y leash van incluidos.</li>
     </ul>
     <p style="margin:0"><a href="${wa}" style="color:#0F9488;font-size:14px;font-weight:600">¿Necesitás cambiar el horario? Escribinos</a></p>`,
  );
}

function rentalOverdueHtml(c: RentalCtx): string {
  const wa = whatsappUrl(`Hola! Sobre la devolución de mi tabla ${c.reference}.`);
  return rentalShell(
    'Tu alquiler venció',
    `<p style="margin:0 0 12px;font-size:14px;color:#1F2937">Hola ${esc(c.customerName)}, tu alquiler <strong>${esc(c.reference)}</strong> (${esc(c.board)}) tenía que volver el <strong>${esc(dtFull(c.endAt))}</strong>.</p>
     <p style="margin:0 0 16px;padding:10px 14px;background:#FDECEA;border-left:3px solid #B3261E;font-size:14px;color:#1F2937">Traé la tabla a la tienda lo antes posible o escribinos para extender. El alquiler sigue corriendo hasta que la devolvés.</p>
     <p style="margin:0"><a href="${wa}" style="color:#0F9488;font-size:14px;font-weight:600">Escribinos por WhatsApp</a></p>`,
  );
}

const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

function rentalCtx(r: any): RentalCtx | null {
  const cust = one<{ full_name?: string; email?: string }>(r.customers);
  if (!cust?.email) return null;
  const model = one<{ name?: string }>(r.board_models)?.name ?? 'Tabla';
  const code = one<{ code?: string }>(r.board_units)?.code ?? '';
  return {
    reference: one<{ reference?: string }>(r.booking_groups)?.reference ?? r.reference,
    rentalRef: r.reference,
    customerName: cust.full_name || 'crack',
    board: code ? `${model} #${code}` : model,
    startAt: r.start_at,
    endAt: r.end_at,
    total: Number(r.total_amount),
    currency: r.currency || 'USD',
    paid: r.payment_method === 'paypal' || !!r.payment_id,
  };
}

const RENTAL_EMAIL_COLS =
  'id, reference, start_at, end_at, total_amount, currency, payment_id, payment_method, customers ( full_name, email ), board_models ( name ), board_units ( code ), booking_groups ( reference )';

/** Rentals 'confirmed' con retiro ~10–34h en el futuro y sin recordatorio. */
export async function sendDueRentalReminders(): Promise<{ processed: number }> {
  if (!isEmailConfigured() || !isSupabaseConfigured()) return { processed: 0 };
  const supabase = getSupabase();
  const now = Date.now();
  const { data } = await supabase
    .from('rentals')
    .select(RENTAL_EMAIL_COLS)
    .eq('status', 'confirmed')
    .is('reminder_sent_at', null)
    .gte('start_at', new Date(now + 10 * 3_600_000).toISOString())
    .lte('start_at', new Date(now + 34 * 3_600_000).toISOString());

  let processed = 0;
  for (const r of (data ?? []) as any[]) {
    const { data: marked } = await supabase
      .from('rentals')
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq('id', r.id)
      .is('reminder_sent_at', null)
      .select('id');
    if (!marked || marked.length === 0) continue;
    const ctx = rentalCtx(r);
    if (!ctx) continue;
    const cust = one<{ email?: string }>(r.customers);
    await sendEmail({
      to: cust!.email as string,
      subject: `Recordatorio: tu alquiler de tabla — ${ctx.reference}`,
      html: rentalReminderHtml(ctx),
    });
    processed++;
  }
  return { processed };
}

/** Rentals 'picked_up' vencidos (>2h) sin aviso: nudge al cliente. */
export async function notifyOverdueRentals(): Promise<{ processed: number }> {
  if (!isEmailConfigured() || !isSupabaseConfigured()) return { processed: 0 };
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const { data } = await supabase
    .from('rentals')
    .select(RENTAL_EMAIL_COLS)
    .eq('status', 'picked_up')
    .is('overdue_notified_at', null)
    .lt('end_at', cutoff);

  let processed = 0;
  for (const r of (data ?? []) as any[]) {
    const { data: marked } = await supabase
      .from('rentals')
      .update({ overdue_notified_at: new Date().toISOString() })
      .eq('id', r.id)
      .is('overdue_notified_at', null)
      .select('id');
    if (!marked || marked.length === 0) continue;
    const ctx = rentalCtx(r);
    if (!ctx) continue;
    const cust = one<{ email?: string }>(r.customers);
    await sendEmail({
      to: cust!.email as string,
      subject: `Tu alquiler venció — ${ctx.reference}`,
      html: rentalOverdueHtml(ctx),
    });
    processed++;
  }
  return { processed };
}
