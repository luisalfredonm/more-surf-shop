import { useEffect, useMemo, useState } from 'react';
import type { default as QrcodeFactory } from 'qrcode-generator';
import { getBrowserSupabase } from '@lib/supabase-browser';

interface Unit {
  id: string;
  code: string;
  status: string;
  board_models: { name: string } | { name: string }[] | null;
}
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

export default function QrStickersView() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeRetired, setIncludeRetired] = useState(false);
  const [qrcode, setQrcode] = useState<typeof QrcodeFactory | null>(null);
  // null = todavía cargando la librería; false = no cargó.
  const [qrOk, setQrOk] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Sin este catch, un import fallido dejaba la vista en "Loading…" para
    // siempre y sin ninguna pista de qué pasó.
    import('qrcode-generator')
      .then((m) => {
        setQrcode(() => m.default);
        setQrOk(true);
      })
      .catch(() => setQrOk(false));

    void getBrowserSupabase()
      .from('board_units')
      .select('id, code, status, board_models ( name )')
      .order('code')
      .then(({ data, error }) => {
        if (error) setErr(error.message);
        setUnits((data ?? []) as unknown as Unit[]);
        setLoading(false);
      });
  }, []);

  const qrSvg = (text: string): string => {
    if (!qrcode) return '';
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 1, scalable: true });
  };

  const shown = useMemo(
    () => units.filter((u) => includeRetired || u.status !== 'retired'),
    [units, includeRetired],
  );

  if (loading || qrOk === null) {
    return (
      <p className="st-empty">
        <span className="st-spin">◠</span> Loading…
      </p>
    );
  }

  return (
    <div>
      <div className="st-noprint">
        {err && <div className="st-err">Could not load the fleet: {err}</div>}
        {qrOk === false && (
          <div className="st-err">
            The QR generator did not load, so the stickers have no code. Reload the page; if it
            keeps happening, restart the dev server. The board numbers below are still correct.
          </div>
        )}
        <p className="st-note" style={{ marginBottom: '0.75rem' }}>
          One sticker per board — the QR carries the <code>code</code>. Print, laminate and stick it
          on the board. The Rentals scanner reads it at hand-over and return.
        </p>
        <div className="st-filters" style={{ marginBottom: '1rem' }}>
          <label className="st-check" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={includeRetired}
              onChange={(e) => setIncludeRetired(e.target.checked)}
            />
            <span>Include retired boards</span>
          </label>
          <span className="st-spacer" />
          <button
            className="st-btn st-btn-primary st-btn-sm"
            onClick={() => window.print()}
            disabled={qrOk !== true}
            title={qrOk !== true ? 'The QR generator did not load' : undefined}
          >
            Print
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="st-empty">No boards. Add the fleet in Fleet.</p>
      ) : (
        <div className="st-qr-sheet">
          {shown.map((u) => (
            <div className="st-qr-sticker" key={u.id}>
              <div className="st-qr-img" dangerouslySetInnerHTML={{ __html: qrSvg(u.code) }} />
              <div className="st-qr-code">{u.code}</div>
              <div className="st-qr-model">{one(u.board_models)?.name ?? ''}</div>
              <div className="st-qr-brand">more surf shop</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
