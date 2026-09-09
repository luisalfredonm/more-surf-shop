import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Pad de firma sin dependencias: captura trazos con pointer events y los
 * serializa a un string SVG. `key`-eá el componente para resetearlo.
 */
export default function SignaturePad({ onChange }: { onChange: (svg: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const strokes = useRef<[number, number][][]>([]);
  const curStroke = useRef<[number, number][]>([]);
  const [has, setHas] = useState(false);
  const W = 480;
  const H = 160;

  const redraw = useCallback(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1a2e';
    for (const s of strokes.current) {
      ctx.beginPath();
      s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const at = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };

  function emit() {
    if (!strokes.current.length) {
      setHas(false);
      onChange(null);
      return;
    }
    const paths = strokes.current
      .map(
        (s) =>
          `<path d="${s
            .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
            .join(' ')}" fill="none" stroke="#1a1a2e" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
      )
      .join('');
    setHas(true);
    onChange(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${paths}</svg>`);
  }

  return (
    <div className="st-sigpad">
      <canvas
        ref={ref}
        width={W}
        height={H}
        onPointerDown={(e) => {
          e.preventDefault();
          drawing.current = true;
          curStroke.current = [at(e)];
          ref.current?.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          curStroke.current.push(at(e));
          redraw();
          const ctx = ref.current?.getContext('2d');
          if (!ctx) return;
          ctx.beginPath();
          curStroke.current.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.stroke();
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          if (curStroke.current.length > 1) strokes.current.push(curStroke.current);
          curStroke.current = [];
          emit();
        }}
        onPointerLeave={() => {
          if (!drawing.current) return;
          drawing.current = false;
          if (curStroke.current.length > 1) strokes.current.push(curStroke.current);
          curStroke.current = [];
          emit();
        }}
      />
      <div className="st-sigpad-foot">
        <span>{has ? 'Signature captured' : 'Sign with your finger or mouse'}</span>
        <button
          type="button"
          className="st-btn st-btn-ghost st-btn-sm"
          onClick={() => {
            strokes.current = [];
            curStroke.current = [];
            redraw();
            emit();
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
