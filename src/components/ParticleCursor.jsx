import { useEffect, useRef } from "react";

// A bright glowing dot cursor with a short, smooth comet trail. The trail is the
// eased pointer path sampled each frame, so it stays continuous and silky — not
// a stream of separate particles.
export default function ParticleCursor() {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!window.matchMedia || !window.matchMedia("(pointer: fine)").matches) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const mouse = { x: w / 2, y: h / 2, seen: false };
    const eased = { x: w / 2, y: h / 2 };
    const trail = []; // recent eased positions (short history)
    const MAXLEN = 14; // short, smooth trail

    const onMove = (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.seen = true;
    };
    window.addEventListener("mousemove", onMove);

    let raf;
    const tick = () => {
      // smooth, lagging follow
      eased.x += (mouse.x - eased.x) * 0.22;
      eased.y += (mouse.y - eased.y) * 0.22;

      if (mouse.seen) {
        trail.push(eased.x, eased.y);
        if (trail.length > MAXLEN * 2) trail.splice(0, trail.length - MAXLEN * 2);
      }

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      // smooth tapering comet trail (tail faint/thin -> head bright/wide), with
      // a soft teal glow so it reads as a flowing light streak.
      const n = trail.length / 2;
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 1; // 0 tail .. 1 head
        const x = trail[i * 2];
        const y = trail[i * 2 + 1];
        const r = 3 + t * 9; // bigger
        const a = t * t * 0.3;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(180, 245, 233, ${a})`);
        g.addColorStop(1, "rgba(120, 220, 210, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // big glowing head: soft teal halo + bright white core
      if (mouse.seen) {
        const Rg = 30;
        const glow = ctx.createRadialGradient(eased.x, eased.y, 0, eased.x, eased.y, Rg);
        glow.addColorStop(0, "rgba(154, 240, 224, 0.38)");
        glow.addColorStop(0.4, "rgba(154, 240, 224, 0.12)");
        glow.addColorStop(1, "rgba(154, 240, 224, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(eased.x, eased.y, Rg, 0, Math.PI * 2);
        ctx.fill();

        const R = 6;
        const core = ctx.createRadialGradient(eased.x, eased.y, 0, eased.x, eased.y, R);
        core.addColorStop(0, "rgba(255, 255, 255, 1)");
        core.addColorStop(0.35, "rgba(214, 255, 247, 0.85)");
        core.addColorStop(1, "rgba(154, 240, 224, 0)");
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(eased.x, eased.y, R, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const prevCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "none";

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      document.documentElement.style.cursor = prevCursor;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[60]"
      aria-hidden
    />
  );
}
