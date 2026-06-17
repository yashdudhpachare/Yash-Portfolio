import { useEffect, useRef, useState } from "react";

const COUNT = 550;

export default function Preloader({ onComplete }) {
  const canvasRef = useRef(null);
  const progRef = useRef(0);
  const doneRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  // Progress timer (eased) — drives how full the globe is.
  useEffect(() => {
    let raf;
    const start = performance.now();
    const duration = 2600;
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      progRef.current = eased;
      setProgress(Math.floor(eased * 100));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setTimeout(() => {
          doneRef.current = true;
          setDone(true);
        }, 450);
        setTimeout(() => onComplete?.(), 1400);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onComplete]);

  // Particle globe: points on a sphere that fade in from the bottom up as the
  // progress fills, with a slow rotation and additive glow.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const SIZE = 25;
    canvas.width = SIZE * DPR;
    canvas.height = SIZE * DPR;
    ctx.scale(DPR, DPR);
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const R = SIZE * 0.42;

    // Fibonacci sphere; `rev` = fill threshold (0 at bottom → 1 at top).
    const pts = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < COUNT; i++) {
      const y = 1 - (i / (COUNT - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = i * golden;
      pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r, rev: (y + 1) / 2 });
    }

    let raf;
    const render = (now) => {
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.globalCompositeOperation = "lighter";
      const prog = progRef.current;
      const a = now * 0.0006;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (const p of pts) {
        if (p.rev > prog) continue;
        const x = p.x * ca - p.z * sa;
        const z = p.x * sa + p.z * ca;
        const sx = cx + x * R;
        const sy = cy - p.y * R;
        const depth = (z + 1) / 2; // 0 back .. 1 front
        const reveal = Math.min(1, (prog - p.rev) * 9);
        const size = (0.16 + depth * 0.5) * reveal;
        const alpha = (0.12 + depth * 0.8) * reveal;
        const rr = Math.round(150 + 105 * depth);
        const bb = Math.round(212 + 43 * depth);
        ctx.fillStyle = `rgba(${rr},236,${bb},${alpha})`;
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      if (!doneRef.current || prog < 1) raf = requestAnimationFrame(render);
      else {
        // keep a couple more frames then stop
        raf = requestAnimationFrame(render);
      }
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-void transition-opacity duration-700 ${
        done ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <div className="flex flex-col items-center gap-4">
        <canvas ref={canvasRef} style={{ width: 25, height: 25 }} aria-hidden />
        <div className="flex items-center gap-3">
          <span className="font-body text-[11px] font-medium uppercase tracking-[0.35em] text-white/55">
            Loading
          </span>
          <span className="font-mono text-[11px] tracking-[0.2em] text-[#9af0e0]/80">
            {String(progress).padStart(3, "0")}
          </span>
        </div>
      </div>
    </div>
  );
}
