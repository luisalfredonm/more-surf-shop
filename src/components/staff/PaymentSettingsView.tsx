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
  const [dirty, setDirty] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<{ ok: boolean; env: string; error?: string } | null>(null);

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
          ? 'Only the owner can view the payment settings.'
          : data.error || 'Could not load the settings.',
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
    setDirty(true);
    setTestRes(null);
  }

  async function runTest() {
    setTesting(true);
    setTestRes(null);
    try {
      const res = await fetch('/api/payments/paypal/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTestRes({ ok: false, env: data.env ?? '', error: data.error || `HTTP ${res.status}` });
        return;
      }
      setTestRes(data as { ok: boolean; env: string; error?: string });
    } finally {
      setTesting(false);
    }
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
        setMsg(data.error || 'Could not save.');
        return;
      }
      setSecret('');
      setDirty(false);
      setTestRes(null);
      if (form.paypal_enabled && !data.ready) {
        setMsg('Saved. Note: PayPal is active but Client ID or Secret is missing.');
      } else {
        setMsg('Saved. The online checkout picks it up in ~30 s.');
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
        <span className="st-spin">◠</span> Loading…
      </p>
    );
  }

  return (
    <div>
      <p className="st-note" style={{ marginBottom: '1rem' }}>
        PayPal credentials for online reservation payments (lessons and rentals). The{' '}
        <strong>secret</strong> is stored in the database and only the owner can see it. Leave
        everything blank to fall back to the environment variables.
      </p>

      <div className="st-card">
        <div className="st-field">
          <label>Status</label>
          <select
            value={form.paypal_enabled ? 'on' : 'off'}
            onChange={(e) => set('paypal_enabled', e.target.value === 'on')}
          >
            <option value="off">Off — online pays at pickup</option>
            <option value="on">Active — online pays with PayPal / card</option>
          </select>
        </div>

        <div className="st-row">
          <div className="st-field">
            <label>PayPal Client ID</label>
            <input
              value={form.paypal_client_id}
              onChange={(e) => set('paypal_client_id', e.target.value)}
              placeholder="From the PayPal Developer Dashboard"
              autoComplete="off"
            />
          </div>
          <div className="st-field">
            <label>Mode</label>
            <select
              value={form.paypal_env}
              onChange={(e) => set('paypal_env', e.target.value as 'sandbox' | 'live')}
            >
              <option value="sandbox">Sandbox (testing)</option>
              <option value="live">Live (real payments)</option>
            </select>
          </div>
        </div>

        <div className="st-field">
          <label>PayPal Secret {form.has_secret && <span className="st-note">· one is already saved</span>}</label>
          <input
            type="password"
            value={secret}
            onChange={(e) => {
              setSecret(e.target.value);
              setDirty(true);
              setTestRes(null);
              setMsg(null);
            }}
            placeholder={form.has_secret ? '•••••••• (leave blank to keep it)' : 'Paste the secret'}
            autoComplete="new-password"
          />
        </div>

        <div className="st-field">
          <label>Webhook ID (optional)</label>
          <input
            value={form.paypal_webhook_id}
            onChange={(e) => set('paypal_webhook_id', e.target.value)}
            placeholder="To verify PayPal webhooks in production"
            autoComplete="off"
          />
          <p className="st-note" style={{ marginTop: '0.3rem' }}>
            Webhook URL: <code>{`${typeof window !== 'undefined' ? window.location.origin : ''}/api/payments/paypal/webhook`}</code>{' '}
            · events <code>PAYMENT.CAPTURE.COMPLETED / .REFUNDED / .REVERSED / .DENIED</code>.
          </p>
        </div>

        {msg && (
          <div className="st-note" style={{ margin: '0.5rem 0' }}>
            {msg}
          </div>
        )}

        {testRes && (
          <div
            className={testRes.ok ? 'st-note' : 'st-err'}
            style={testRes.ok ? { margin: '0.5rem 0', color: '#15803d', fontWeight: 600 } : { margin: '0.5rem 0' }}
          >
            {testRes.ok
              ? `✓ Connected to PayPal (${testRes.env}). The credentials work.`
              : `✗ ${testRes.error ?? 'PayPal rejected the credentials.'}`}
          </div>
        )}

        <div className="st-inline" style={{ gap: '0.5rem' }}>
          <button className="st-btn st-btn-primary" type="button" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          <button
            className="st-btn st-btn-ghost"
            type="button"
            disabled={testing || saving}
            onClick={runTest}
          >
            {testing ? 'Testing…' : 'Test connection'}
          </button>
        </div>
        <p className="st-note" style={{ marginTop: '0.4rem' }}>
          "Test connection" requests a token from PayPal using the <strong>saved</strong> values
          {dirty ? ' — save first to test the changes' : ''}.
          {form.updated_at && ` Last updated: ${new Date(form.updated_at).toLocaleString('en-US')}.`}
        </p>
      </div>
    </div>
  );
}
