import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getBrowserSupabase, browserSupabaseConfigured } from '@lib/supabase-browser';
import StaffLogin from './StaffLogin';
import AgendaView from './AgendaView';
import WeeklyScheduleView from './WeeklyScheduleView';
import DateOverridesView from './DateOverridesView';
import PricesView from './PricesView';
import RentalsView from './RentalsView';
import FleetView from './FleetView';
import RentalSettingsView from './RentalSettingsView';
import './staff.css';

type View =
  | 'bookings'
  | 'weekly'
  | 'overrides'
  | 'prices'
  | 'rentals'
  | 'fleet'
  | 'rental_settings';

const VIEW_TITLE: Record<View, string> = {
  bookings: 'Bookings',
  prices: 'Prices & Services',
  weekly: 'Weekly Schedule',
  overrides: 'Date Overrides',
  rentals: 'Rentals',
  fleet: 'Fleet',
  rental_settings: 'Rental Settings',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

const NAV: { section: string; items: { key: View; label: string; disabled?: boolean }[] }[] = [
  {
    section: 'Surf Lessons',
    items: [
      { key: 'bookings', label: 'Bookings' },
      { key: 'prices', label: 'Prices & Services' },
      { key: 'weekly', label: 'Weekly Schedule' },
      { key: 'overrides', label: 'Date Overrides' },
    ],
  },
  {
    section: 'Board Rentals',
    items: [
      { key: 'rentals', label: 'Rentals' },
      { key: 'fleet', label: 'Fleet' },
      { key: 'rental_settings', label: 'Rental Settings' },
    ],
  },
];
interface Profile {
  role: 'owner' | 'staff';
  display_name: string;
  active: boolean;
}

export default function StaffApp() {
  const configured = browserSupabaseConfigured();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [view, setView] = useState<View>('bookings');

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
    setView('bookings');
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
          {NAV.map((group) => (
            <div className="st-side-group" key={group.section}>
              <span className="st-side-section">{group.section}</span>
              {group.items.map((item, i) => (
                <button
                  key={`${item.key}-${i}`}
                  className={!item.disabled && view === item.key ? 'is-active' : ''}
                  disabled={item.disabled}
                  onClick={() => !item.disabled && setView(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="st-side-foot">
          <span className="st-side-user">
            {profile.display_name || 'staff'} · {profile.role}
          </span>
          <button onClick={signOut}>Salir</button>
        </div>
      </aside>

      <div className="st-content">
        <header className="st-topbar">
          <div className="st-topbar-head">
            <h1>{VIEW_TITLE[view]}</h1>
            <span className="st-topbar-sub">More Surf Shop · Tamarindo, Costa Rica</span>
          </div>
          <span className="st-topbar-spacer" />
          <a className="st-topbar-link" href="/" target="_blank" rel="noopener noreferrer">
            View site ↗
          </a>
          <span className="st-avatar" title={profile.display_name || profile.role}>
            {initials(profile.display_name || profile.role)}
          </span>
        </header>
        <main className="st-main">
          {view === 'bookings' && <AgendaView />}
          {view === 'prices' && <PricesView />}
          {view === 'weekly' && <WeeklyScheduleView />}
          {view === 'overrides' && <DateOverridesView />}
          {view === 'rentals' && <RentalsView />}
          {view === 'fleet' && <FleetView />}
          {view === 'rental_settings' && <RentalSettingsView />}
        </main>
      </div>
    </div>
  );
}
