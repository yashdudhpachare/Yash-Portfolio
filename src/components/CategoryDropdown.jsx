import { useEffect, useRef, useState } from "react";
import { projectsForCategory } from "../projectsData.js";

// Compact glass dropdown that replaces the wrapping pill row in the WORK
// gallery. It occupies a single fixed-height control at the top-center, so it
// never wraps to multiple rows and never collides with the project card — which
// keeps the layout tidy on short 16:9 screens. The menu is a floating popover.
export default function CategoryDropdown({ categories, active, onSelect }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const activeCount = projectsForCategory(active).length;

  return (
    <div
      ref={rootRef}
      className="pointer-events-auto fixed left-1/2 top-6 z-30 -translate-x-1/2"
    >
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Filter projects. Current category: ${active}`}
        className="cat-trigger flex max-w-[90vw] items-center gap-3 rounded-full py-3 pl-5 pr-4 focus-visible:outline-none"
      >
        <span className="hidden font-body text-[10px] font-medium uppercase tracking-[0.24em] text-white/45 sm:inline">
          Work
        </span>
        <span className="truncate font-body text-sm font-semibold tracking-tight text-white">
          {active}
        </span>
        <span className="cat-trigger__count font-mono text-[11px] tabular-nums">
          {String(activeCount).padStart(2, "0")}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-white/65 transition-transform duration-300 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Project categories"
          className="cat-menu absolute left-1/2 top-[calc(100%+0.6rem)] z-30 -translate-x-1/2"
        >
          {categories.map((c) => {
            const isActive = c === active;
            const n = projectsForCategory(c).length;
            return (
              <li key={c} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(c);
                    setOpen(false);
                    btnRef.current?.focus();
                  }}
                  data-active={isActive || undefined}
                  className="cat-item flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left focus-visible:outline-none"
                >
                  <span className="cat-item__dot" aria-hidden />
                  <span className="flex-1 truncate font-body text-sm font-medium tracking-tight">
                    {c}
                  </span>
                  <span className="cat-item__count font-mono text-[11px] tabular-nums">
                    {String(n).padStart(2, "0")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
