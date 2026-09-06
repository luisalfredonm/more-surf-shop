import { useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

export default function StaffLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await getBrowserSupabase().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setError('Email o contraseña incorrectos.');
      setBusy(false);
    }
    // Con éxito, onAuthStateChange en StaffApp toma el control.
  }

  return (
    <div className="st-center">
      <form className="st-login" onSubmit={submit}>
        <h1>
          more<span style={{ color: 'var(--teal)' }}>surf</span>shop
        </h1>
        <p>Panel de staff</p>

        {error && <div className="st-err">{error}</div>}

        <div className="st-field">
          <label htmlFor="st-email">Email</label>
          <input
            id="st-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            required
          />
        </div>
        <div className="st-field">
          <label htmlFor="st-pass">Contraseña</label>
          <input
            id="st-pass"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            required
          />
        </div>

        <button className="st-btn st-btn-primary st-btn-block" disabled={busy} type="submit">
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
