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

  useEffect(() => {
    void import('qrcode-generator').then((m) => setQrcode(() => m.default));
    void getBrowserSupabase()
      .from('board_units')
      .select('id, code, status, board_models ( name )')
      .order('code')
      .then(({ data }) => {
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

  if (loading || !qrcode) {
    return (
      <p className="st-empty">
        <span className="st-spin">◠</span> Cargando…
      </p>
    );
  }

  return (
    <div>
      <div className="st-noprint">
        <p className="st-note" style={{ marginBottom: '0.75rem' }}>
          Un sticker por tabla — el QR lleva el <code>code</code>. Imprimí, plastificá y pegá en la
          tabla. El escáner de Rentals lo lee en entrega y devolución.
        </p>
        <div className="st-filters" style={{ marginBottom: '1rem' }}>
          <label className="st-check" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={includeRetired}
              onChange={(e) => setIncludeRetired(e.target.checked)}
            />
            <span>Incluir tablas retiradas</span>
          </label>
          <span className="st-spacer" />
          <button className="st-btn st-btn-primary st-btn-sm" onClick={() => window.print()}>
            Imprimir
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="st-empty">Sin tablas. Cargá la flota en Fleet.</p>
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
