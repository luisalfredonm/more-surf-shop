import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getBrowserSupabase, browserSupabaseConfigured } from '@lib/supabase-browser';
import StaffLogin from './StaffLogin';
import AgendaView from './AgendaView';
import SlotsView from './SlotsView';
import './staff.css';

type View = 'agenda' | 'slots';
interface Profile {
  role: 'owner' | 'staff';
  display_name: string;
  active: boolean;
}

export default function StaffApp() {
  const configured = browserSupabaseConfigured();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [view, setView] = useState<View>('agenda');

  useEffect(() => {
    if (!configured) return;
    const sb = getBrowserSupabase();
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [configured]);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) {
      setProfile(null);
      return;
    }
    setProfile(undefined);
    getBrowserSupabase()
      .from('profiles')
      .select('role, display_name, active')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setProfile((data as Profile) ?? null));
  }, [session]);

  async function signOut() {
    await getBrowserSupabase().auth.signOut();
    setView('agenda');
  }

  if (!configured) {
    return (
      <div className="st-center">
        <div className="st-login">
          <h1>Panel de staff</h1>
          <p>Falta configurar Supabase.</p>
          <p className="st-note">
            Definí <code>PUBLIC_SUPABASE_URL</code> y <code>PUBLIC_SUPABASE_ANON_KEY</code> en{' '}
            <code>.env</code> y recargá.
          </p>
        </div>
      </div>
    );
  }

  if (session === undefined || (session && profile === undefined)) {
    return (
      <div className="st-center">
        <span className="st-spin">◠</span>
      </div>
    );
  }

  if (!session) return <StaffLogin />;

  if (!profile || !profile.active) {
    return (
      <div className="st-center">
        <div className="st-login">
          <h1>Sin acceso</h1>
          <p>Tu usuario no está habilitado en el panel.</p>
          <button className="st-btn st-btn-ghost st-btn-block" onClick={signOut}>
            Salir
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="st-wrap">
      <aside className="st-side">
        <span className="st-side-brand">
          more<span>surf</span>shop
        </span>
        <nav className="st-side-nav">
          <button
            className={view === 'agenda' ? 'is-active' : ''}
            onClick={() => setView('agenda')}
          >
            Agenda
          </button>
          <button
            className={view === 'slots' ? 'is-active' : ''}
            onClick={() => setView('slots')}
          >
            Slots
          </button>
        </nav>
        <div className="st-side-foot">
          <span className="st-side-user">
            {profile.display_name || 'staff'} · {profile.role}
          </span>
          <button onClick={signOut}>Salir</button>
        </div>
      </aside>

      <div className="st-content">
        <main className="st-main">{view === 'agenda' ? <AgendaView /> : <SlotsView />}</main>
      </div>
    </div>
  );
}
