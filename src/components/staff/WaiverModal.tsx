import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@lib/supabase-browser';

interface WaiverRow {
  id: string;
  waiver_version: string;
  activity: string;
  signed_at: string;
  signer_name_typed: string;
  accepted_terms: boolean;
  is_minor: boolean;
  guardian_name: string | null;
  ip: string | null;
  user_agent: string | null;
  rendered_text_snapshot: string;
  signature_svg: string | null;
  lang: string;
}

const COLS =
  'id, waiver_version, activity, signed_at, signer_name_typed, accepted_terms, is_minor, guardian_name, ip, user_agent, rendered_text_snapshot, signature_svg, lang';

export default function WaiverModal({
  waiverId,
  participantName,
  emergencyName,
  emergencyPhone,
  onClose,
}: {
  waiverId: string;
  participantName: string;
  emergencyName: string | null;
  emergencyPhone: string | null;
  onClose: () => void;
}) {
  const [row, setRow] = useState<WaiverRow | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    void getBrowserSupabase()
      .from('waivers')
      .select(COLS)
      .eq('id', waiverId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setErr(error.message);
        else if (!data) setErr('No se encontró el waiver.');
        else setRow(data as unknown as WaiverRow);
      });
    return () => {
      cancelled = true;
    };
  }, [waiverId]);

  const sigSrc =
    row?.signature_svg && `data:image/svg+xml,${encodeURIComponent(row.signature_svg)}`;

  return (
    <div className="st-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-modal-card" role="dialog" aria-modal="true" aria-label="Waiver firmado">
        <div className="st-modal-hd">
          <h3>Waiver</h3>
          <span className="st-modal-ref">{participantName}</span>
          <span className="st-spacer" />
          <button className="st-modal-x" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {err && <div className="st-err">{err}</div>}
        {!row && !err && (
          <p className="st-empty">
            <span className="st-spin">◠</span> Cargando…
          </p>
        )}

        {row && (
          <>
            <dl className="st-audit">
              <dt>Firmado por</dt>
              <dd>
                {row.signer_name_typed}
                {row.is_minor && (
                  <>
                    {' '}
                    · como tutor de <strong>{participantName}</strong> (menor)
                  </>
                )}
              </dd>
              <dt>Fecha</dt>
              <dd>{new Date(row.signed_at).toLocaleString('en-US')}</dd>
              <dt>Aceptó términos</dt>
              <dd>{row.accepted_terms ? 'Sí' : 'No'}</dd>
              <dt>Versión</dt>
              <dd>
                {row.waiver_version} · {row.lang} · {row.activity}
              </dd>
              {(emergencyName || emergencyPhone) && (
                <>
                  <dt>Contacto emergencia</dt>
                  <dd>
                    {emergencyName || '—'}
                    {emergencyPhone ? ` · ${emergencyPhone}` : ''}
                  </dd>
                </>
              )}
              <dt>IP</dt>
              <dd>{row.ip || '—'}</dd>
              <dt>Navegador</dt>
              <dd className="st-audit-ua">{row.user_agent || '—'}</dd>
            </dl>

            <div className="st-field-label">Firma</div>
            {sigSrc ? (
              <div className="st-waiver-sig">
                <img src={sigSrc} alt={`Firma de ${row.signer_name_typed}`} />
              </div>
            ) : (
              <p className="st-note">Sin firma dibujada.</p>
            )}

            <div className="st-field-label">Texto aceptado (snapshot)</div>
            <pre className="st-waiver-snapshot">{row.rendered_text_snapshot}</pre>
          </>
        )}
      </div>
    </div>
  );
}
