import { useEffect, useMemo, useRef, useState } from "react";
import { projectsForCategory } from "../projectsData.js";

// The live preview is rendered at this "design" desktop resolution, then
// CSS-scaled down to the card width — so each card shows the real Vercel site
// looking like a crisp desktop screenshot (not a squished mobile layout).
const DESIGN_W = 1440;
const DESIGN_H = 900; // 16:10 to match the card frame

// How many cards on either side of the centered one get a live iframe.
// Everything else falls back to the static poster so we never spin up 16
// live sites at once.
const LIVE_WINDOW = 1;

function cardWidthPx() {
  // Mirrors the CSS `--rail-card-w` formula:
  //   min( clamp(440px, 54vw, 820px), 96vh )
  // The 96vh cap keeps the card from outgrowing shorter 16:9 viewports.
  if (typeof window === "undefined") return 820;
  const byWidth = Math.max(440, Math.min(820, window.innerWidth * 0.54));
  return Math.min(byWidth, window.innerHeight * 0.96);
}

// Horizontal DOM gallery rendered OVER the WebGL canvas. The row is translated
// horizontally by the shared scroll progress (projScrollRef) and each card's
// distance from viewport-center drives a `--focus` variable (0..1) that the
// CSS uses to scale + brighten the active card and dim its neighbors.
export default function ProjectsRail({ projScrollRef, activeCat, onActiveChange }) {
  const trackRef = useRef(null);
  const viewRef = useRef(null);
  const cardRefs = useRef([]);

  const list = useMemo(() => projectsForCategory(activeCat), [activeCat]);

  // Which card is centered (drives which cards mount a live iframe).
  const [active, setActive] = useState(0);
  // Scale factor that shrinks the DESIGN_W iframe down to the card width.
  const [scale, setScale] = useState(() => cardWidthPx() / DESIGN_W);

  useEffect(() => {
    const onResize = () => setScale(cardWidthPx() / DESIGN_W);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Reset to the first card whenever the category (list) changes.
  useEffect(() => {
    setActive(0);
  }, [list]);

  useEffect(() => {
    // Drop stale refs from a previously-larger category so the active/focus
    // math uses the CURRENT card count (otherwise cards stay half-blurred and
    // never highlight after switching folders).
    cardRefs.current.length = list.length;
    let raf;
    let lastIdx = -1;
    const loop = () => {
      const prog = Math.min(1, Math.max(0, projScrollRef?.current ?? 0));
      const track = trackRef.current;
      const view = viewRef.current;
      if (track && view) {
        const max = Math.max(0, track.scrollWidth - view.clientWidth);
        track.style.transform = `translate3d(${-prog * max}px,0,0)`;
      }

      const N = list.length;
      const center = prog * Math.max(0, N - 1);
      const activeIdx = Math.round(center);
      for (let i = 0; i < N; i++) {
        const el = cardRefs.current[i];
        if (!el) continue;
        const d = Math.abs(i - center);
        // Smoothstep falloff: full focus at d=0, fully dim by d≈1.
        const t = Math.max(0, 1 - Math.min(1, d));
        const focus = t * t * (3 - 2 * t);
        el.style.setProperty("--focus", focus.toFixed(3));
        if (i === activeIdx) el.setAttribute("data-active", "");
        else el.removeAttribute("data-active");
      }
      if (activeIdx !== lastIdx && N > 0) {
        lastIdx = activeIdx;
        setActive(activeIdx);
        onActiveChange?.(activeIdx);
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [projScrollRef, list, onActiveChange]);

  return (
    <div
      ref={viewRef}
      className="pointer-events-none fixed inset-0 z-20 flex items-center overflow-hidden"
    >
      <div
        ref={trackRef}
        className="flex items-stretch gap-10 will-change-transform"
        style={{
          paddingInline: "calc((100vw - var(--rail-card-w)) / 2)",
        }}
      >
        {list.map((p, i) => {
          const live = Math.abs(i - active) <= LIVE_WINDOW;
          return (
            <a
              key={p.n}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${p.title} — ${p.cat} case study (opens live site)`}
              className="rail-card group pointer-events-auto relative block w-[var(--rail-card-w)] shrink-0 focus-visible:outline-none"
              style={{ "--focus": 0 }}
            >
              <div className="rail-card__frame relative aspect-[16/10] overflow-hidden rounded-2xl border border-white/12 bg-[#0b0e14] shadow-[0_30px_80px_rgba(0,0,0,0.55)] transition duration-300 group-hover:border-white/30 group-hover:shadow-[0_40px_100px_rgba(0,0,0,0.7)] group-focus-visible:border-white/40">
                {/* Static poster: instant paint + fallback for off-screen cards
                    and any site that refuses to be embedded. */}
                <img
                  src={p.img}
                  alt={p.title}
                  loading="lazy"
                  className="absolute inset-0 block h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
                />
                {/* Live Vercel preview for the centered card + neighbors. */}
                {live && (
                  <iframe
                    src={p.url}
                    title={p.title}
                    loading="lazy"
                    tabIndex={-1}
                    scrolling="no"
                    sandbox="allow-scripts allow-same-origin"
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 origin-top-left border-0"
                    style={{
                      width: `${DESIGN_W}px`,
                      height: `${DESIGN_H}px`,
                      transform: `scale(${scale})`,
                      pointerEvents: "none",
                    }}
                  />
                )}
                {/* Click shield: keeps the card a clean thumbnail and routes the
                    click to the parent <a> (open live site in a new tab). */}
                <span className="absolute inset-0 z-[2]" aria-hidden />
              </div>
              {/* Badge lives OUTSIDE the overflow-hidden frame so the rounded
                  corner never clips it. */}
              <span className="pointer-events-none absolute right-4 top-4 z-10 inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.18)] bg-[rgba(14,17,24,0.6)] pl-5 pr-4 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-white/90 shadow-[0_4px_14px_rgba(0,0,0,0.5)] backdrop-blur-md transition duration-300 group-hover:border-[#9af0e0]/50 group-hover:bg-[#0a463c]/75 group-hover:text-[#dafff6]">
                View Live
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17L17 7M9 7h8v8" />
                </svg>
              </span>
            {/* Meta shows ONLY for the centered card, so the visible number
                always matches the bottom counter. */}
            <div className="rail-card__meta mt-4 flex w-full items-center gap-4">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-[#5be1c9]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-body text-base font-semibold tracking-tight text-white">
                  {p.title}
                </span>
                {p.year && (
                  <span className="font-mono text-xs text-white/60">— {p.year}</span>
                )}
              </div>
              {/* 3 keywords describing the project — right-aligned on the same row. */}
              {p.tags && p.tags.length > 0 && (
                <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                  {p.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-[#9af0e0]/40 bg-black/70 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-white shadow-[0_3px_12px_rgba(0,0,0,0.7)] backdrop-blur-md"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
