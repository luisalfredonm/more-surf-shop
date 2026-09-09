/**
 * Cliente PayPal (Orders v2) para uso en server (API routes).
 *
 * Config: se lee de la tabla `payment_settings` (la edita el dueño en el panel).
 * Si esa fila no existe o está vacía, cae a las env vars PAYPAL_ENV /
 * PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_WEBHOOK_ID.
 * El client_id (público) lo sirve el server a `/reservation` para el SDK JS.
 */
import { getSupabase } from './supabase';

export interface PayPalConfig {
  clientId: string;
  secret: string;
  webhookId: string;
  env: 'sandbox' | 'live';
  base: string;
  enabled: boolean;
}

interface PayPalSettingsRow {
  paypal_enabled: boolean;
  paypal_env: string | null;
  paypal_client_id: string | null;
  paypal_secret: string | null;
  paypal_webhook_id: string | null;
}

let cachedCfg: { value: PayPalConfig; exp: number } | null = null;

export function clearPayPalConfigCache(): void {
  cachedCfg = null;
  cachedToken = null;
}

/** Config efectiva de PayPal (DB → fallback env). Cacheada 30 s. */
export async function getPayPalConfig(): Promise<PayPalConfig> {
  const now = Date.now();
  if (cachedCfg && cachedCfg.exp > now) return cachedCfg.value;

  let row: PayPalSettingsRow | null = null;
  try {
    const { data } = await getSupabase()
      .from('payment_settings')
      .select('paypal_enabled, paypal_env, paypal_client_id, paypal_secret, paypal_webhook_id')
      .eq('id', 1)
      .maybeSingle();
    row = (data as PayPalSettingsRow | null) ?? null;
  } catch {
    /* tabla aún no creada → sólo env */
  }

  const envRaw = row?.paypal_env ?? import.meta.env.PAYPAL_ENV;
  const env: 'sandbox' | 'live' = envRaw === 'live' ? 'live' : 'sandbox';
  const clientId = (row?.paypal_client_id || import.meta.env.PAYPAL_CLIENT_ID || '').trim();
  const secret = (row?.paypal_secret || import.meta.env.PAYPAL_CLIENT_SECRET || '').trim();
  const webhookId = (row?.paypal_webhook_id || import.meta.env.PAYPAL_WEBHOOK_ID || '').trim();

  // Con fila: respeta el toggle del panel. Sin fila: "configurado" = hay creds en env.
  const enabled = row
    ? !!row.paypal_enabled && !!clientId && !!secret
    : !!(clientId && secret);

  const cfg: PayPalConfig = {
    clientId,
    secret,
    webhookId,
    env,
    base: env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com',
    enabled,
  };
  cachedCfg = { value: cfg, exp: now + 30_000 };
  return cfg;
}

export async function isPayPalConfigured(): Promise<boolean> {
  const c = await getPayPalConfig();
  return c.enabled && !!c.clientId && !!c.secret;
}

/**
 * Prueba las credenciales guardadas contra el OAuth de PayPal (no depende del
 * toggle `enabled`). Devuelve ok:true si PayPal entregó un token.
 */
export async function testCredentials(): Promise<{
  ok: boolean;
  env: 'sandbox' | 'live';
  error?: string;
}> {
  clearPayPalConfigCache();
  const cfg = await getPayPalConfig();
  if (!cfg.clientId || !cfg.secret) {
    return { ok: false, env: cfg.env, error: 'Faltan Client ID o Secret.' };
  }
  try {
    const res = await fetch(`${cfg.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.secret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (res.ok) return { ok: true, env: cfg.env };
    let detail = '';
    try {
      const j = (await res.json()) as { error_description?: string; error?: string };
      detail = j.error_description || j.error || '';
    } catch {
      detail = (await res.text().catch(() => '')).slice(0, 160);
    }
    const hint =
      res.status === 401
        ? 'Client ID or Secret invalid for this mode.'
        : `PayPal responded ${res.status}.`;
    return { ok: false, env: cfg.env, error: `${hint}${detail ? ` (${detail})` : ''}` };
  } catch (e) {
    return {
      ok: false,
      env: cfg.env,
      error: e instanceof Error ? e.message : 'No se pudo conectar con PayPal.',
    };
  }
}

let cachedToken: { value: string; exp: number; key: string } | null = null;

async function accessToken(): Promise<string> {
  const cfg = await getPayPalConfig();
  const key = `${cfg.env}:${cfg.clientId}`;
  const now = Date.now();
  if (cachedToken && cachedToken.key === key && cachedToken.exp > now + 60_000) {
    return cachedToken.value;
  }

  const res = await fetch(`${cfg.base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.secret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    throw new Error(`PayPal token ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  cachedToken = { value: data.access_token, exp: now + data.expires_in * 1000, key };
  return cachedToken.value;
}

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const cfg = await getPayPalConfig();
  const token = await accessToken();
  const res = await fetch(`${cfg.base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`PayPal ${path} -> ${res.status} ${text.slice(0, 500)}`);
  }
  return data;
}

export interface CreateOrderInput {
  amount: number;
  currency: string;
  bookingId: string;
  reference: string;
  description: string;
}

export async function createOrder(i: CreateOrderInput): Promise<{ id: string }> {
  const data = await api('/v2/checkout/orders', {
    method: 'POST',
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: { currency_code: i.currency, value: i.amount.toFixed(2) },
          custom_id: i.bookingId,
          invoice_id: `${i.reference}-${Math.random().toString(36).slice(2, 7)}`,
          description: i.description.slice(0, 127),
        },
      ],
      application_context: {
        brand_name: 'More Surf Shop',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
      },
    }),
  });
  return { id: data.id };
}

export interface CaptureResult {
  status: string;
  captureId: string | null;
  amount: string | null;
  currency: string | null;
  payerEmail: string | null;
  bookingId: string | null;
}

export async function captureOrder(orderId: string): Promise<CaptureResult> {
  const data = await api(`/v2/checkout/orders/${orderId}/capture`, { method: 'POST' });
  const pu = data.purchase_units?.[0];
  const cap = pu?.payments?.captures?.[0];
  return {
    status: data.status ?? cap?.status ?? 'UNKNOWN',
    captureId: cap?.id ?? null,
    amount: cap?.amount?.value ?? null,
    currency: cap?.amount?.currency_code ?? null,
    payerEmail: data.payer?.email_address ?? null,
    bookingId: pu?.custom_id ?? null,
  };
}

export async function refundCapture(
  captureId: string,
  amount: string,
  currency: string,
): Promise<{ status: string; id: string | null }> {
  const data = await api(`/v2/payments/captures/${captureId}/refund`, {
    method: 'POST',
    body: JSON.stringify({ amount: { value: amount, currency_code: currency } }),
  });
  return { status: data.status ?? 'UNKNOWN', id: data.id ?? null };
}

export interface WebhookVerifyInput {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
  body: string; // JSON crudo, tal cual llegó
}

export async function verifyWebhook(i: WebhookVerifyInput): Promise<boolean> {
  const cfg = await getPayPalConfig();
  if (!cfg.webhookId) return false;
  try {
    const res = await api('/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      body: JSON.stringify({
        transmission_id: i.transmissionId,
        transmission_time: i.transmissionTime,
        transmission_sig: i.transmissionSig,
        cert_url: i.certUrl,
        auth_algo: i.authAlgo,
        webhook_id: cfg.webhookId,
        webhook_event: JSON.parse(i.body),
      }),
    });
    return res.verification_status === 'SUCCESS';
  } catch {
    return false;
  }
}
