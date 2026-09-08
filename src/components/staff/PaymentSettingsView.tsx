import { useCallback, useEffect, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

interface Loaded {
  paypal_enabled: boolean;
  paypal_env: 'sandbox' | 'live';
  paypal_client_id: string;
  paypal_webhook_id: string;
  has_secret: boolean;
  updated_at: string | null;
}

export default function PaymentSettingsView() {
  const [form, setForm] = useState<Loaded | null>(null);
  const [secret, setSecret] = useState(''); // vacío = no cambiar
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const token = useCallback(async () => {
    const { data } = await getBrowserSupabase().auth.getSession();
    return data.session?.access_token ?? '';
  }, []);

  const load = useCallback(async () => {
    setLoadErr(null);
    const res = await fetch('/api/payments/settings', {
      headers: { Authorization: `Bearer ${await token()}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      setLoadErr(
        data.code === 'forbidden'
          ? 'Sólo el dueño puede ver la configuración de pagos.'
          : data.error || 'No se pudo cargar la configuración.',
      );
      return;
    }
    setForm({
      paypal_enabled: !!data.paypal_enabled,
      paypal_env: data.paypal_env === 'live' ? 'live' : 'sandbox',
      paypal_client_id: data.paypal_client_id ?? '',
      paypal_webhook_id: data.paypal_webhook_id ?? '',
      has_secret: !!data.has_secret,
      updated_at: data.updated_at ?? null,
    });
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function set<K extends keyof Loaded>(k: K, v: Loaded[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setMsg(null);
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/payments/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          paypal_enabled: form.paypal_enabled,
          paypal_env: form.paypal_env,
          paypal_client_id: form.paypal_client_id.trim() || null,
          paypal_webhook_id: form.paypal_webhook_id.trim() || null,
          ...(secret.trim() ? { paypal_secret: secret.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setMsg(data.error || 'No se pudo guardar.');
        return;
      }
      setSecret('');
      if (form.paypal_enabled && !data.ready) {
        setMsg('Guardado. Ojo: PayPal está activo pero faltan Client ID o Secret.');
      } else {
        setMsg('Guardado. El checkout online lo toma en ~30 s.');
      }
      void load();
    } finally {
      setSaving(false);
    }
  }

  if (loadErr) return <div className="st-err">{loadErr}</div>;
  if (!form) {
    return (
      <p className="st-empty">
        <span className="st-spin">◠</span> Cargando…
      </p>
    );
  }

  return (
    <div>
      <p className="st-note" style={{ marginBottom: '1rem' }}>
        Credenciales de PayPal para el pago online de reservas (lecciones y alquileres). El{' '}
        <strong>secret</strong> se guarda en la base y sólo lo ve el dueño. Si dejás todo vacío, la
        app usa las variables de entorno.
      </p>

      <div className="st-card">
        <div className="st-field">
          <label>Estado</label>
          <select
            value={form.paypal_enabled ? 'on' : 'off'}
            onChange={(e) => set('paypal_enabled', e.target.value === 'on')}
          >
            <option value="off">Desactivado — online paga al retirar</option>
            <option value="on">Activo — online paga con PayPal / tarjeta</option>
          </select>
        </div>

        <div className="st-row">
          <div className="st-field">
            <label>PayPal Client ID</label>
            <input
              value={form.paypal_client_id}
              onChange={(e) => set('paypal_client_id', e.target.value)}
              placeholder="Del PayPal Developer Dashboard"
              autoComplete="off"
            />
          </div>
          <div className="st-field">
            <label>Modo</label>
            <select
              value={form.paypal_env}
              onChange={(e) => set('paypal_env', e.target.value as 'sandbox' | 'live')}
            >
              <option value="sandbox">Sandbox (pruebas)</option>
              <option value="live">Live (pagos reales)</option>
            </select>
          </div>
        </div>

        <div className="st-field">
          <label>PayPal Secret {form.has_secret && <span className="st-note">· ya hay uno guardado</span>}</label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={form.has_secret ? '•••••••• (dejalo vacío para no cambiarlo)' : 'Pegá el secret'}
            autoComplete="new-password"
          />
        </div>

        <div className="st-field">
          <label>Webhook ID (opcional)</label>
          <input
            value={form.paypal_webhook_id}
            onChange={(e) => set('paypal_webhook_id', e.target.value)}
            placeholder="Para verificar los webhooks de PayPal en producción"
            autoComplete="off"
          />
          <p className="st-note" style={{ marginTop: '0.3rem' }}>
            Webhook URL: <code>{`${typeof window !== 'undefined' ? window.location.origin : ''}/api/payments/paypal/webhook`}</code>{' '}
            · eventos <code>PAYMENT.CAPTURE.COMPLETED / .REFUNDED / .REVERSED / .DENIED</code>.
          </p>
        </div>

        {msg && (
          <div className="st-note" style={{ margin: '0.5rem 0' }}>
            {msg}
          </div>
        )}
        <button className="st-btn st-btn-primary" type="button" disabled={saving} onClick={save}>
          {saving ? 'Guardando…' : 'Guardar configuración'}
        </button>
        {form.updated_at && (
          <p className="st-note" style={{ marginTop: '0.4rem' }}>
            Última actualización: {new Date(form.updated_at).toLocaleString('en-US')}
          </p>
        )}
      </div>
    </div>
  );
}
