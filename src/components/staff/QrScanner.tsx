import { useEffect, useRef, useState } from 'react';
import type { default as JsQR } from 'jsqr';

/**
 * Escáner de QR con la cámara. Llama onScan(text) con el contenido del primer
 * QR que lee, o con lo que se tipee a mano. Sin dependencias de UI: overlay +
 * <video> + jsQR (import dinámico).
 */
export default function QrScanner({
  onScan,
  onClose,
}: {
  onScan: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let decode: typeof JsQR | null = null;
    const canvas = document.createElement('canvas');

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);

    (async () => {
      // La API de cámara sólo existe en contexto seguro (https o localhost).
      if (!navigator.mediaDevices?.getUserMedia) {
        setErr(
          window.isSecureContext
            ? 'Este navegador no da acceso a la cámara. Escribí el nº de tabla.'
            : `La cámara necesita HTTPS o localhost (estás en ${window.location.host}). Escribí el nº de tabla.`,
        );
        return;
      }
      try {
        decode = (await import('jsqr')).default;
      } catch {
        setErr('No se pudo cargar el lector de QR. Escribí el nº de tabla.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
      } catch (e1) {
        // Reintento sin preferencia de cámara (device sin cámara trasera).
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (e2) {
          setErr(camMessage(e2 ?? e1));
          return;
        }
      }
      if (stopped) return;
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      try {
        await v.play();
      } catch {
        /* autoplay puede fallar; el frame igual llega */
      }
      tick();
    })();

    function tick() {
      if (stopped || !decode) {
        if (!stopped) rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const v = videoRef.current;
      if (v && v.readyState === v.HAVE_ENOUGH_DATA) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const found = decode(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (found && found.data) {
            stopped = true;
            onScan(found.data.trim());
            return;
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      stopped = true;
      window.removeEventListener('keydown', onKey);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onScan, onClose]);

  return (
    <div className="st-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-modal-card" role="dialog" aria-modal="true" aria-label="Escanear QR">
        <div className="st-modal-hd">
          <h3>Escanear tabla</h3>
          <span className="st-spacer" />
          <button className="st-modal-x" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {err ? (
          <div className="st-err">{err}</div>
        ) : (
          <>
            <div className="st-qr-cam">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video ref={videoRef} playsInline muted />
              <span className="st-qr-reticle" />
            </div>
            <p className="st-note" style={{ marginTop: '0.6rem' }}>
              Apuntá al sticker de la tabla, o escribí el número.
            </p>
          </>
        )}

        <form
          className="st-inline"
          style={{ marginTop: err ? 0 : '0.5rem' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) onScan(manual.trim());
          }}
        >
          <input
            autoFocus={!!err}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Nº de tabla (ej. 6.2 Ap)"
            style={{ flex: 1 }}
          />
          <button type="submit" className="st-btn st-btn-primary st-btn-sm" disabled={!manual.trim()}>
            Usar
          </button>
        </form>
      </div>
    </div>
  );
}

function camMessage(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Permiso de cámara denegado. Habilitalo en el candado de la barra de direcciones, o escribí el nº de tabla.';
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DevicesNotFoundError':
      return 'No se encontró una cámara en este dispositivo. Escribí el nº de tabla.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'La cámara está en uso por otra app. Cerrala y reintentá, o escribí el nº de tabla.';
    default:
      return 'No se pudo abrir la cámara. Escribí el nº de tabla.';
  }
}
