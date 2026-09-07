import { useEffect, useRef, useState } from 'react';
import type { default as JsQR } from 'jsqr';

/**
 * Escáner de QR con la cámara. Llama onScan(text) con el contenido del primer
 * QR que lee y se cierra. Sin dependencias de UI: overlay + <video> + jsQR.
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
      try {
        decode = (await import('jsqr')).default;
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (stopped) return;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        tick();
      } catch {
        setErr('No se pudo abrir la cámara. Permití el acceso o buscá por número.');
      }
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
          <div className="st-qr-cam">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} playsInline muted />
            <span className="st-qr-reticle" />
          </div>
        )}
        <p className="st-note" style={{ marginTop: '0.6rem' }}>
          Apuntá al sticker de la tabla.
        </p>
      </div>
    </div>
  );
}
