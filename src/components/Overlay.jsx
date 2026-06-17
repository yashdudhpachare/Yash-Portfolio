import { useEffect, useState } from "react";

const ROLES = ["Product Designer", "Product Management", "AI Builder"];

// Cycles the hero role with a vertical slide-in / slide-out. Remounting the
// inner word (via key) restarts the CSS `roleSwap` animation each tick.
function RoleRotator() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % ROLES.length), 2400);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      className="role-rotator font-body text-base font-semibold tracking-wide text-[#9af0e0] sm:text-lg"
      aria-live="polite"
    >
      <span key={i} className="role-rotator__word">
        {ROLES[i]}
      </span>
    </span>
  );
}

export default function Overlay({ visible, morphing }) {
  // Intro shows at the very top; the moment you scroll (morphing) it blurs away
  // so it never competes with the mountain reveal.
  const show = visible && !morphing;

  // Staggered blur-in / blur-out per line.
  const line = (delay, y = 14) => ({
    transition: "opacity 0.9s ease, transform 0.9s ease, filter 0.9s ease",
    transitionDelay: show ? delay : "0ms",
    opacity: show ? 1 : 0,
    transform: show ? "translateY(0)" : `translateY(${morphing ? -y : y}px)`,
    filter: show ? "blur(0px)" : "blur(8px)",
  });

  return (
    <div className="pointer-events-none fixed inset-0 z-50 select-none">
      {/* "Hi, I'm Yash" intro — centered */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <span
          style={line("0.05s")}
          className="font-body text-[11px] font-medium uppercase tracking-[0.45em] text-white/50 sm:text-xs"
        >
          Hi, I&apos;m
        </span>
        <h1
          style={line("0.2s", 22)}
          className="mt-2 font-serif text-[clamp(3.6rem,13vw,9rem)] italic leading-[0.9] tracking-tight text-white"
        >
          Yash<span className="not-italic text-[#9af0e0]">.</span>
        </h1>
        <div style={line("0.42s")} className="mt-5 flex flex-col items-center gap-1.5">
          <RoleRotator />
          <p className="max-w-[34ch] font-body text-sm font-light tracking-wide text-white/50 sm:text-base">
            UX strategy, research &amp; shipping user-centered products.
          </p>
        </div>
      </div>

      {/* Scroll cue — bottom-centered, fades with the same logic */}
      <div
        className={`absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3 transition-all duration-700 ease-out ${
          show ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
        }`}
        style={{ transitionDelay: show ? "0.6s" : "0ms" }}
      >
        <span className="font-body text-[11px] font-medium uppercase tracking-[0.34em] text-white/65">
          Scroll to explore
        </span>
        <span className="scroll-mouse">
          <i />
        </span>
        <svg
          className="scroll-chevs text-white/75"
          width="20"
          height="16"
          viewBox="0 0 24 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 4l7 6 7-6" />
          <path d="M5 9l7 6 7-6" />
        </svg>
      </div>
    </div>
  );
}
