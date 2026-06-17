import { useEffect, useRef, useState } from "react";

// Soothing ambient loop. Browsers block audio-with-sound until a user gesture,
// so we attempt to play immediately and also on the first pointer/key event.
// A small equalizer button lets the visitor mute/unmute.
export default function BackgroundMusic({ show = true, mutedRef }) {
  const ref = useRef(null);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    a.volume = 0.5;
    const tryPlay = () => {
      a.play().catch(() => {});
    };
    tryPlay(); // may be blocked; the gesture listeners below cover that
    const onGesture = () => {
      if (!a.muted) tryPlay();
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      // Stop playback on unmount (prevents lingering audio across hot-reloads).
      a.pause();
    };
  }, []);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    const next = !muted;
    setMuted(next);
    if (mutedRef) mutedRef.current = next; // let transition FX respect the toggle
    a.muted = next;
    // Pause/play as well as mute, so "off" truly stops the sound.
    if (next) a.pause();
    else a.play().catch(() => {});
  };

  return (
    <>
      <audio ref={ref} src="/audio/ambient.mp3?v=reawakening" loop preload="auto" />
      {show && (
        <button
          type="button"
          onClick={toggle}
          aria-label={muted ? "Unmute music" : "Mute music"}
          aria-pressed={muted}
          className="glass-ui pointer-events-auto fixed bottom-6 left-6 z-50 grid h-11 w-11 place-items-center rounded-full text-[#9af0e0] transition hover:scale-105"
        >
          <span className={`eq ${muted ? "is-muted" : ""}`} aria-hidden>
            <span />
            <span />
            <span />
            <span />
          </span>
        </button>
      )}
    </>
  );
}
