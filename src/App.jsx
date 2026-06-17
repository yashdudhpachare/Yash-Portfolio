import { useEffect, useRef, useState } from "react";
import Lenis from "lenis";
import * as THREE from "three";
import Scene from "./three/Scene.jsx";
import Preloader from "./components/Preloader.jsx";
import Overlay from "./components/Overlay.jsx";
import ParticleCursor from "./components/ParticleCursor.jsx";
import ProjectsRail from "./components/ProjectsRail.jsx";
import CategoryDropdown from "./components/CategoryDropdown.jsx";
import LogoStrip from "./components/LogoStrip.jsx";
import BackgroundMusic from "./components/BackgroundMusic.jsx";
import { projectsForCategory } from "./projectsData.js";

// How many cards a category shows (drives how much scroll the gallery needs).
const countFor = (c) => projectsForCategory(c).length;

// Per-card scroll distance in viewports — the SINGLE source of truth shared by
// both the scroll-zone height and the scroll→progress mapping, so they can never
// drift out of sync. n<=1 => 0 (no scroll needed).
const perCardVh = (n) => (n <= 1 ? 0 : Math.min(0.3, 4.5 / (n - 1)));

// Scroll-zone height (vh): exactly long enough that the LAST slide is centered
// at the bottom. 1-slide categories get no scroll zone.
const projVh = (cat) => {
  const n = countFor(cat);
  return Math.round(100 + perCardVh(n) * Math.max(0, n - 1) * 100);
};

const smoothstepJS = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Walk-mode standpoint just in front of the WORK portal — where you land when
// you return from the projects section (so you're back where you entered).
const PORTAL_STAND = new THREE.Vector3(-0.5, -11, 8.6);
const PORTAL_LOOK = new THREE.Vector3(-4.8, -10.4, 4.0);       // face the WORK portal on arrival
const PORTAL_ENTRY_FROM = new THREE.Vector3(1.8, -6.6, 11.4);  // short "step out of portal" start

// Category pills for the WORK section: 6 case-study folders + an overview.
const CATEGORIES = [
  "Selected Work",
  "Digital Product",
  "New Product Development",
  "Physical Product",
  "Quantitative Market Study",
  "Research",
  "Miscellaneous",
];

export default function App() {
  const [entered, setEntered] = useState(false);
  const [morphing, setMorphing] = useState(false);
  const [atValley, setAtValley] = useState(false);
  const [roam, setRoam] = useState(false);
  const [nearPortal, setNearPortal] = useState(null); // null | "WORK" | "ABOUT"
  const [phase, setPhase] = useState("home"); // home | warp | projects | about
  const [warpTarget, setWarpTarget] = useState("projects"); // which section the warp leads to
  const warpTargetRef = useRef("projects"); // ref mirror for the in-frame camera director
  const [activeCat, setActiveCat] = useState("Selected Work"); // selected work-section pill
  const [scrollVh, setScrollVh] = useState(500); // scroll-zone height (home cinematic vs gallery)
  const sRef = useRef(0);
  const lenisRef = useRef(null);
  const phaseRef = useRef("home");
  const warpRef = useRef(0);
  const revealRef = useRef(0);
  const projScrollRef = useRef(0);
  const projIntroRef = useRef(0);          // 0..1 automatic fly-in when projects open
  const snapTimerRef = useRef(null);       // debounce timer for scroll-end snap
  const [currentIdx, setCurrentIdx] = useState(0); // active rail card (drives bottom counter + arrow disabled states)
  const currentIdxRef = useRef(0);                 // live mirror so the key handler always reads the latest card
  const galleryCountRef = useRef(countFor("Selected Work")); // # of cards in the active category
  const atPortalRef = useRef(false);      // true = resting at the WORK portal after return
  const roamLandingRef = useRef(null);    // where the next walk hand-off lands (null = default)
  const roamLookRef = useRef(null);       // world point the walk hand-off faces (null = center)
  const roamEntryFromRef = useRef(null);  // local swoop-start for a clean return (null = default)
  const walkPoseRef = useRef(null);       // live first-person pose while walking {x,y,z,yaw}
  const savedEntryRef = useRef(null);     // snapshot of the spot you entered the WORK portal from
  const cameFromWalkRef = useRef(false);  // true = entered a section by walking into a portal
  const audioMutedRef = useRef(false);    // mirrors the music mute toggle

  useEffect(() => {
    // Don't let the browser restore the previous scroll position on reload —
    // always begin the experience at the hero, not mid-cinematic.
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    window.scrollTo(0, 0);

    const lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
    lenisRef.current = lenis;
    lenis.scrollTo(0, { immediate: true });

    let raf;
    const loop = (t) => {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onScroll = ({ scroll }) => {
      const vh = window.innerHeight;
      if (phaseRef.current === "projects") {
        // Gallery scroll (0..1). 0.30 viewport per card = deliberate, ~270px
        // on a 900px screen — slow enough to read each project as it passes
        // through center. The cap lifts to 4.5 so all 16 still fit comfortably.
        const nn = galleryCountRef.current || 1;
        const per = vh * perCardVh(nn);
        const range = per * Math.max(0, nn - 1);
        projScrollRef.current = range > 0 ? Math.min(1, Math.max(0, scroll / range)) : 0;

        // Snap-to-center: 200ms after the last scroll event, ease the page
        // scroll to the exact pixel for the nearest card. Lenis handles the
        // smooth animation; the rail follows automatically.
        clearTimeout(snapTimerRef.current);
        snapTimerRef.current = setTimeout(() => {
          if (phaseRef.current !== "projects") return;
          if (nn <= 1) return;
          const targetIdx = Math.round(projScrollRef.current * (nn - 1));
          const targetScroll = targetIdx * per;
          if (Math.abs(targetScroll - scroll) > 1) {
            lenisRef.current?.scrollTo(targetScroll, { duration: 0.55 });
          }
        }, 200);
        return;
      }
      // Home cinematic 0..1: hero -> fly into valley -> orbit -> hero shot.
      sRef.current = Math.min(1, Math.max(0, scroll / (vh * 4.0)));
      setMorphing(scroll > vh * 0.06);
      setAtValley(sRef.current >= 0.985);
      // If the user actually scrolls away from the valley end, drop the
      // "rest at the portal" state so the normal cinematic resumes.
      if (Math.abs(scroll - vh * 4.0) > vh * 0.15) {
        atPortalRef.current = false;
        roamLandingRef.current = null;
        roamLookRef.current = null;
        roamEntryFromRef.current = null;
      }
    };
    lenis.on("scroll", onScroll);

    return () => {
      lenis.off("scroll", onScroll);
      lenis.destroy();
      cancelAnimationFrame(raf);
    };
  }, []);

  // Leaving pointer-lock (Esc) drops us back into the scroll cinematic.
  useEffect(() => {
    const onLockChange = () => {
      if (!document.pointerLockElement) {
        setRoam(false);
        lenisRef.current?.start();
      }
    };
    document.addEventListener("pointerlockchange", onLockChange);
    return () => document.removeEventListener("pointerlockchange", onLockChange);
  }, []);

  // Dev shortcut: ?to=projects jumps straight into the WORK section.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("to") === "projects") {
      phaseRef.current = "projects";
      setPhase("projects");
      projIntroRef.current = 1;
      revealRef.current = 1;
      projScrollRef.current = 0;
      currentIdxRef.current = 0;
      setCurrentIdx(0);
      setScrollVh(100); // gallery is arrow-driven — no vertical scroll zone
      lenisRef.current?.scrollTo(0, { immediate: true });
      lenisRef.current?.start();
    }
  }, []);

  // Pick a category pill → filter the gallery and reset to its first project.
  const pickCategory = (c) => {
    setActiveCat(c);
    galleryCountRef.current = countFor(c);
    projScrollRef.current = 0;
    currentIdxRef.current = 0;
    setCurrentIdx(0); // jump back to the first project of the new category
  };

  // Step the rail by ±1 card. Shared by the bottom arrow buttons + arrow keys.
  // Translates the page scroll to the exact pixel for that card; Lenis smooths.
  // Navigation is arrow-only: just move the active index. A rAF tween (below)
  // eases the rail to this card — there is no page scrolling in the gallery.
  const stepCard = (delta) => {
    if (phaseRef.current !== "projects") return;
    const nn = galleryCountRef.current || 1;
    if (nn <= 1) return;
    const cur = currentIdxRef.current;
    const next = Math.max(0, Math.min(nn - 1, cur + delta));
    if (next === cur) return;
    currentIdxRef.current = next;
    setCurrentIdx(next);
  };

  // Keep the ref in sync if currentIdx is ever set elsewhere.
  useEffect(() => {
    currentIdxRef.current = currentIdx;
  }, [currentIdx]);

  // Hard-lock page scrolling in the WORK gallery (arrow-only navigation), no
  // matter how you got here or what scrollVh happens to be. Restore on exit.
  useEffect(() => {
    if (phase === "projects" || phase === "about") {
      lenisRef.current?.stop();
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    } else {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    }
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    };
  }, [phase]);

  // Drive the rail purely from the active card: smoothly ease projScroll (0..1)
  // toward currentIdx/(N-1). The rail reads projScrollRef every frame, so this
  // animates left/right slide changes without any vertical scrolling.
  useEffect(() => {
    let raf;
    const tick = () => {
      if (phaseRef.current === "projects") {
        const nn = galleryCountRef.current || 1;
        const target = nn > 1 ? currentIdxRef.current / (nn - 1) : 0;
        const cur = projScrollRef.current ?? 0;
        const next = cur + (target - cur) * 0.16;
        projScrollRef.current = Math.abs(target - next) < 0.0006 ? target : next;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Keyboard in the WORK gallery: ←/→ step one slide; ↑/↓ (and Space/PageUp/Down)
  // are swallowed so the keys never scroll the page — navigation is slide-by-slide.
  useEffect(() => {
    const onKey = (e) => {
      if (phaseRef.current !== "projects") return;
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          stepCard(1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          stepCard(-1);
          break;
        case "ArrowUp":
        case "ArrowDown":
        case "PageUp":
        case "PageDown":
        case " ":
          e.preventDefault(); // stop vertical key-scrolling in the gallery
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey, { passive: false });
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the current section (WORK or ABOUT) → reverse the transition back to
  // the home portal you entered from (drops you into walk mode right there).
  const returnToWorkPortal = () => {
    if (
      (phaseRef.current !== "projects" && phaseRef.current !== "about") ||
      returningRef.current
    )
      return;
    returningRef.current = true;
    returnSwitchedRef.current = false;
    // User gesture → safe to re-assert pointer lock for the walk hand-off.
    document.querySelector("canvas")?.requestPointerLock?.();
  };

  // Hero nav "Home" → glide back to the very top of the cinematic.
  const goHome = () => {
    lenisRef.current?.scrollTo(0, { duration: 1.0 });
  };

  // One Home action for the global button: inside a section it closes back to
  // the hero; in the home cinematic / valley it glides up to the hero top.
  const homeClick = () => {
    if (phaseRef.current === "projects" || phaseRef.current === "about") {
      returnToHero();
    } else {
      goHome();
    }
  };

  // Home from inside a section (WORK/ABOUT) → always close back to the hero page
  // (force the hero return path regardless of how the section was entered).
  const returnToHero = () => {
    if (
      (phaseRef.current !== "projects" && phaseRef.current !== "about") ||
      returningRef.current
    )
      return;
    cameFromWalkRef.current = false; // force the hero return branch
    returningRef.current = true;
    returnSwitchedRef.current = false;
  };

  const enterRoam = () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return;
    atPortalRef.current = false; // walking now; leave the portal-rest pose
    lenisRef.current?.stop();
    setRoam(true);
    canvas.requestPointerLock?.();
  };

  // Both portals run the SAME suck-in warp; `target` decides which section the
  // dive lands in (WORK gallery vs ABOUT). Remember the exact spot you entered
  // from so closing the section drops you back there in walk mode.
  const enterWarp = (target) => {
    if (phaseRef.current !== "home") return;
    // Remember HOW we entered: walking into a portal → close back into walk mode
    // at that spot; straight from the hero nav → close back to the hero page.
    cameFromWalkRef.current = roam;
    savedEntryRef.current = walkPoseRef.current ? { ...walkPoseRef.current } : null;
    warpTargetRef.current = target;
    setWarpTarget(target);
    if (document.pointerLockElement) document.exitPointerLock?.();
    setRoam(false);
    lenisRef.current?.stop();
    warpRef.current = 0;
    revealRef.current = 0;
    phaseRef.current = "warp";
    setPhase("warp");
  };

  // WORK portal -> projects gallery.
  const enterPortal = () => enterWarp("projects");
  // ABOUT portal (end of the bridge) -> about section (same mountain, new angle).
  const enterPortal2 = () => enterWarp("about");

  // Cinematic fade-through-darkness during the black-hole absorb. Driven each
  // frame from warpRef/phase so it peaks (full black) right at the swallow, then
  // eases back open as the new world assembles — hiding the camera cut.
  const [warpFade, setWarpFade] = useState(0);
  const fadeRef = useRef(0);
  const returningRef = useRef(false); // true while reverse-transitioning to home
  const returnSwitchedRef = useRef(false);
  useEffect(() => {
    let raf;
    const tick = () => {
      let target = 0;
      if (returningRef.current) {
        target = 1; // fade to black, then drop back into the home valley
        // Once it's dark enough, swap to the home valley (hidden by the black).
        if (fadeRef.current > 0.9 && !returnSwitchedRef.current) {
          returnSwitchedRef.current = true;
          const vh = window.innerHeight;
          warpRef.current = 0;
          revealRef.current = 0;
          projScrollRef.current = 0;
          setScrollVh(500); // restore the full home cinematic scroll-zone

          phaseRef.current = "home";
          setPhase("home");

          if (!cameFromWalkRef.current) {
            // Entered straight from the hero nav (not walking) → close back to
            // the hero page itself, not into walk mode at a portal.
            sRef.current = 0; // top of the cinematic = hero
            atPortalRef.current = false;
            roamLandingRef.current = null;
            roamLookRef.current = null;
            roamEntryFromRef.current = null;
            setAtValley(false);
            setMorphing(false);
            setRoam(false);
            lenisRef.current?.scrollTo(0, { immediate: true });
            lenisRef.current?.start();
          } else {
            sRef.current = 1; // valley end (used if you later Esc out of walking)
            // Return to the exact spot you entered from (captured in enterWarp),
            // facing the same way; fall back to the fixed portal pose if unknown.
            const se = savedEntryRef.current;
            if (se) {
              const pos = new THREE.Vector3(se.x, se.y ?? -10, se.z);
              const fwd = new THREE.Vector3(-Math.sin(se.yaw), 0, -Math.cos(se.yaw));
              roamLandingRef.current = pos;
              roamLookRef.current = pos.clone().add(fwd.clone().multiplyScalar(6));
              // Brief drop-in from slightly behind + above so it lands cleanly.
              roamEntryFromRef.current = pos
                .clone()
                .add(fwd.clone().multiplyScalar(-2.5))
                .add(new THREE.Vector3(0, 4, 0));
            } else {
              roamLandingRef.current = PORTAL_STAND; // walk hand-off lands at the WORK portal
              roamLookRef.current = PORTAL_LOOK;     // ...facing the WORK portal
              roamEntryFromRef.current = PORTAL_ENTRY_FROM; // ...short step-out swoop
            }
            atPortalRef.current = false;
            setAtValley(true);
            setMorphing(true);
            lenisRef.current?.scrollTo(vh * 4.0, { immediate: true });
            lenisRef.current?.stop(); // hand control to first-person walk
            // Drop straight into walking at the portal so you can stroll to ABOUT.
            setRoam(true);
            const cv = document.querySelector("canvas");
            cv?.requestPointerLock?.();
            // Graceful fallback: if the lock was blocked, settle into the
            // portal-rest view with the "Click to walk around" prompt instead.
            setTimeout(() => {
              if (phaseRef.current === "home" && !document.pointerLockElement) {
                setRoam(false);
                atPortalRef.current = true;
                lenisRef.current?.start();
              }
            }, 500);
          }
          returningRef.current = false; // now let the darkness ease open
        }
      } else if (phaseRef.current === "warp") {
        // No black-out anymore — the camera flight + particle cross-dissolve IS
        // the transition. Just a whisper of darkening at the mid-flight crossover
        // (home gone / projects forming) for depth, easing back to clear.
        const w = warpRef.current;
        target = 0.22 * smoothstepJS(0.3, 0.55, w) * (1 - smoothstepJS(0.6, 0.9, w));
      } else {
        target = 0; // ease back open
      }
      const k = target > fadeRef.current ? 0.1 : 0.06;
      fadeRef.current += (target - fadeRef.current) * k;
      if (fadeRef.current < 0.001) fadeRef.current = 0;
      setWarpFade(fadeRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Leaving the WORK section is via the close (✕) button — see returnToWorkPortal.

  const onWarpDone = () => {
    const target = warpTargetRef.current; // "projects" | "about"
    if (phaseRef.current === target) return;
    phaseRef.current = target;
    setPhase(target);
    // The warp already flew the camera to the section vantage and assembled the
    // mountain — start settled (intro=1) so there's no jump back to a far fly-in.
    projIntroRef.current = 1;
    setScrollVh(100); // sections are not vertically scrolled
    if (target === "projects") {
      projScrollRef.current = 0;
      currentIdxRef.current = 0;
      setCurrentIdx(0);
    }
    lenisRef.current?.scrollTo(0, { immediate: true });
    lenisRef.current?.start();
  };

  return (
    <>
      {/* Global dark backdrop (the canvas is transparent in ABOUT, so this and
          the glass card below show through behind the mountain particles). */}
      <div className="fixed inset-0 z-0 bg-void" />

      {/* ABOUT: glassmorphic card sitting BEHIND the mountain model. Painted
          before the canvas (same z) so the particles render in front of it. */}
      {phase === "about" && (
        <div className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center">
          <div
            className="about-glass-card"
            style={{
              width: "clamp(560px, 74vw, 1200px)",
              height: "80vh",
              WebkitMaskImage:
                "linear-gradient(to bottom, #000 0%, #000 52%, transparent 96%)",
              maskImage:
                "linear-gradient(to bottom, #000 0%, #000 52%, transparent 96%)",
            }}
          />
        </div>
      )}

      {/* Fixed full-screen WebGL world (transparent in ABOUT) */}
      <div className="fixed inset-0 z-0">
        <Scene
          sRef={sRef}
          roam={roam}
          phase={phase}
          phaseRef={phaseRef}
          warpRef={warpRef}
          revealRef={revealRef}
          projScrollRef={projScrollRef}
          projIntroRef={projIntroRef}
          atPortalRef={atPortalRef}
          roamLanding={roamLandingRef.current}
          roamLookAt={roamLookRef.current}
          roamEntryFrom={roamEntryFromRef.current}
          roamPoseRef={walkPoseRef}
          activeCat={activeCat}
          warpTarget={warpTarget}
          warpTargetRef={warpTargetRef}
          onEnterPortal={enterPortal}
          onEnterPortal2={enterPortal2}
          onWarpDone={onWarpDone}
          onNearPortal={setNearPortal}
        />
      </div>

      {/* Cinematic black-hole fade: a soft radial darkness that closes in as the
          dust is swallowed, then eases open on the new world. */}
      <div
        className="pointer-events-none fixed inset-0 z-40"
        style={{
          opacity: warpFade,
          background:
            "radial-gradient(circle at 50% 50%, #000 0%, #000 35%, rgba(0,0,0,0.6) 70%, rgba(0,0,0,0.2) 100%)",
          transition: "none",
        }}
      />

      <Overlay visible={entered && phase === "home"} morphing={morphing} />

      {/* Soothing ambient background loop + mute toggle */}
      <BackgroundMusic show={entered} mutedRef={audioMutedRef} />

      {/* Hero top nav: Home logo (left) + section jumps (right). Fades away the
          moment you scroll into the cinematic. */}
      {entered && phase === "home" && !roam && (
        <nav
          className={`pointer-events-none fixed inset-x-0 top-0 z-50 flex items-center justify-end px-6 py-5 transition-all duration-700 ease-out sm:px-8 ${
            morphing ? "-translate-y-3 opacity-0" : "translate-y-0 opacity-100"
          }`}
        >
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] p-1.5 backdrop-blur-xl">
            <button
              type="button"
              onClick={() => enterWarp("projects")}
              className="rounded-full px-4 py-2 font-body text-xs font-semibold uppercase tracking-[0.14em] text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              Work
            </button>
            <button
              type="button"
              onClick={() => enterWarp("about")}
              className="rounded-full bg-white px-4 py-2 font-body text-xs font-semibold uppercase tracking-[0.14em] text-zinc-900 transition hover:scale-[1.03]"
            >
              About &amp; Contact
            </button>
          </div>
        </nav>
      )}

      {/* Flowing particle cursor (desktop only; off during first-person roam) */}
      {!roam && <ParticleCursor />}

      {/* Global Home logo (top-left) — present everywhere you can click (hero,
          valley/portal view, and inside the WORK/ABOUT sections). Hidden only
          during active first-person walk, where the pointer is locked. */}
      {entered && !roam && (
        <button
          type="button"
          onClick={homeClick}
          aria-label="Home"
          className="pointer-events-auto fixed left-6 top-6 z-50 inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.06] py-2 pl-2 pr-5 backdrop-blur-xl transition hover:border-white/35"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white font-serif text-lg italic leading-none text-zinc-900">
            Y
          </span>
          <span className="font-body text-xs font-semibold uppercase tracking-[0.18em] text-white/85">
            Home
          </span>
        </button>
      )}

      {/* Projects: scroll-up cue (top) + category pills (bottom) */}
      {phase === "projects" && (
        <>
          <ProjectsRail
            projScrollRef={projScrollRef}
            activeCat={activeCat}
          />
          <button
            onClick={returnToWorkPortal}
            aria-label="Close work section"
            className="glass-ui pointer-events-auto fixed right-6 top-6 z-40 grid h-12 w-12 place-items-center rounded-full text-white/85 transition hover:scale-105 hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <CategoryDropdown
            categories={CATEGORIES}
            active={activeCat}
            onSelect={pickCategory}
          />

          {/* Bottom nav: prev / counter / next. Click or use ←/→ keys. */}
          {(() => {
            const N = countFor(activeCat);
            if (N <= 1) return null;
            const atStart = currentIdx <= 0;
            const atEnd = currentIdx >= N - 1;
            return (
              <div className="pointer-events-auto fixed bottom-8 left-1/2 z-30 flex -translate-x-1/2 items-center gap-4">
                <button
                  type="button"
                  onClick={() => stepCard(-1)}
                  disabled={atStart}
                  aria-label="Previous project"
                  className="rail-nav-btn"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <div
                  className="rail-nav-counter font-mono text-xs tracking-[0.22em] tabular-nums"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <span className="text-white">{String(currentIdx + 1).padStart(2, "0")}</span>
                  <span className="mx-1.5 text-white/35">/</span>
                  <span className="text-white/55">{String(N).padStart(2, "0")}</span>
                </div>
                <button
                  type="button"
                  onClick={() => stepCard(1)}
                  disabled={atEnd}
                  aria-label="Next project"
                  className="rail-nav-btn"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </div>
            );
          })()}
        </>
      )}

      {/* ABOUT section — same mountain at a new angle. Content TBD; for now just
          a close button + a placeholder heading so the flow is testable. */}
      {phase === "about" && (
        <>
          <button
            onClick={returnToWorkPortal}
            aria-label="Close about section"
            className="glass-ui pointer-events-auto fixed right-6 top-6 z-40 grid h-12 w-12 place-items-center rounded-full text-white/85 transition hover:scale-105 hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>

          {/* About content — floats in front of the scene; the glass card glows
              behind the mountain as the backdrop. */}
          <div
            className="pointer-events-none fixed inset-0 z-30 flex flex-col items-center justify-center px-6 py-[clamp(1rem,4vh,3rem)] text-center"
            style={{ textShadow: "0 2px 28px rgba(0,0,0,0.65)" }}
          >
            <span className="about-portrait pointer-events-auto mb-[clamp(0.5rem,1.5vh,1.25rem)] -mt-[clamp(0.5rem,3vh,2.5rem)]">
              <img src="/yash.png" alt="Yash Dudhpachare" className="about-portrait__img" />
            </span>
            <span className="font-body text-[11px] font-medium uppercase tracking-[0.45em] text-white/55">
              About me
            </span>
            <h2 className="mt-[clamp(0.5rem,1.4vh,1rem)] max-w-[28ch] font-serif text-[clamp(1.8rem,min(5.2vw,6vh),4.25rem)] italic leading-[1.0] tracking-tight text-white">
              I design products people genuinely<br />love to use<span className="not-italic text-[#9af0e0]">.</span>
            </h2>
            <p className="mt-[clamp(0.5rem,2vh,1.5rem)] max-w-[74ch] font-body text-[clamp(0.78rem,1.6vh,1rem)] font-light leading-[1.5] tracking-wide text-white/80">
              I&apos;m Yash — a product designer with an architect&apos;s eye and a
              builder&apos;s hands. After a B.Arch in Mumbai I earned my M.Des at
              IISc Bangalore, and I&apos;ve spent 2+ years turning ambiguous
              problems into clear, shippable products.
            </p>
            <p className="mt-[clamp(0.4rem,1.2vh,1rem)] max-w-[74ch] font-body text-[clamp(0.78rem,1.6vh,1rem)] font-light leading-[1.5] tracking-wide text-white/70">
              At Trimble I design enterprise SaaS alongside PMs and engineers,
              turning messy requirements into clear, usable flows. Off the clock
              I build AI products end-to-end — wiring LLMs, vision and automation
              (n8n, Cursor, Claude) into experiences people actually want to use.
            </p>
            <div className="mt-[clamp(0.6rem,2vh,2rem)] flex flex-wrap items-center justify-center gap-2.5">
              {[
                "2+ yrs in product",
                "M.Des · IISc Bangalore",
                "GATE AIR 56 — Top 0.3%",
                "Designer × PM × AI builder",
              ].map((s) => (
                <span
                  key={s}
                  className="rounded-full border border-white/20 bg-white/[0.06] px-4 py-1.5 font-body text-[11px] font-medium uppercase tracking-[0.12em] text-white/80 backdrop-blur-md"
                >
                  {s}
                </span>
              ))}
            </div>

            {/* Contact bar — compact horizontal card; details shown as text,
                LinkedIn opens the profile. */}
            <div className="pointer-events-auto mt-[clamp(0.75rem,2.4vh,2.25rem)] flex w-full max-w-[860px] flex-col items-stretch overflow-hidden rounded-[1.4rem] border border-white/15 bg-white/[0.06] backdrop-blur-2xl shadow-[0_30px_80px_rgba(0,0,0,0.5)] sm:flex-row">
              <div className="flex min-w-0 flex-1 items-center gap-3.5 px-6 py-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.07] text-[#9af0e0]">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6.5 12 13l9-6.5M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
                  </svg>
                </span>
                <span className="flex min-w-0 flex-col text-left">
                  <span className="font-body text-[10px] font-medium uppercase tracking-[0.28em] text-white/40">
                    Email
                  </span>
                  <span className="select-all truncate font-body text-sm tracking-wide text-white/90">
                    dudhpachareyash@gmail.com
                  </span>
                </span>
              </div>
              <div className="h-px w-full bg-white/12 sm:h-auto sm:w-px" />
              <div className="flex min-w-0 flex-1 items-center gap-3.5 px-6 py-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.07] text-[#9af0e0]">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </span>
                <span className="flex min-w-0 flex-col text-left">
                  <span className="font-body text-[10px] font-medium uppercase tracking-[0.28em] text-white/40">
                    Phone
                  </span>
                  <span className="select-all truncate font-body text-sm tracking-wide text-white/90">
                    +91 9834526925
                  </span>
                </span>
              </div>
              <div className="h-px w-full bg-white/12 sm:h-auto sm:w-px" />
              <a
                href="https://www.linkedin.com/in/yashdudhpachare/"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex min-w-0 flex-1 items-center gap-3.5 px-6 py-4 transition hover:bg-white/[0.04]"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.07] text-[#9af0e0]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4.98 3.5A2.5 2.5 0 1 1 0 3.5a2.5 2.5 0 0 1 4.98 0zM.25 8.25h4.5V24h-4.5V8.25zM8.5 8.25h4.31v2.15h.06c.6-1.14 2.07-2.34 4.26-2.34 4.56 0 5.4 3 5.4 6.9V24h-4.5v-6.95c0-1.66-.03-3.8-2.32-3.8-2.32 0-2.68 1.81-2.68 3.68V24H8.5V8.25z" />
                  </svg>
                </span>
                <span className="flex min-w-0 flex-col text-left">
                  <span className="font-body text-[10px] font-medium uppercase tracking-[0.28em] text-white/40">
                    LinkedIn
                  </span>
                  <span className="truncate font-body text-sm tracking-wide text-white/90 group-hover:text-[#9af0e0]">
                    /yashdudhpachare
                  </span>
                </span>
              </a>
            </div>
          </div>

          {/* Floating, looping strip of the tools I work with, in front of the
              mountain. */}
          <LogoStrip />
        </>
      )}

      {/* Small footer hint while walking but not near any portal. When near,
          the curved "ENTER" prompt on the portal itself takes over. */}
      {/* Only when NOT near a portal — the portal shows its own curved ENTER,
          so we don't duplicate that prompt here. */}
      {roam && phase === "home" && !nearPortal && (
        <div className="pointer-events-none fixed bottom-28 left-1/2 z-30 -translate-x-1/2">
          <div className="glass-ui flex items-center gap-1.5 rounded-full px-3 py-1.5">
            <span className="h-1 w-1 animate-pulse rounded-full bg-[#9af0e0]" />
            <span className="font-body text-[10px] font-medium uppercase tracking-[0.16em] text-white/75">
              Find a glowing portal
            </span>
          </div>
        </div>
      )}

      {/* Prompt to drop into first-person walk mode — climactic hero CTA. */}
      {atValley && !roam && phase === "home" && (
        <div className="hero-cta-wrap pointer-events-none fixed bottom-14 left-1/2 z-30">
          <button
            onClick={enterRoam}
            aria-label="Walk around the valley in first-person"
            className="hero-cta group pointer-events-auto relative inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-5 font-body text-xs font-semibold uppercase tracking-[0.18em] focus-visible:outline-none"
          >
            <span aria-hidden className="hero-cta__halo" />
            <span
              aria-hidden
              className="grid h-6 w-6 place-items-center rounded-full bg-[#0a463c] text-[#9af0e0] shadow-[inset_0_-2px_4px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(154,240,224,0.25)] transition-transform duration-300 group-hover:translate-x-0.5"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h13" />
                <path d="M12 5l7 7-7 7" />
              </svg>
            </span>
            <span className="relative">Click to walk around</span>
          </button>
        </div>
      )}

      {/* In-roam controls hint */}
      {roam && (
        <div className="pointer-events-none fixed bottom-9 left-1/2 z-30 -translate-x-1/2">
          <div className="glass-ui flex items-center gap-3 rounded-2xl px-3.5 py-1.5">
            <span className="flex items-center gap-2">
              <span className="flex gap-1">
                <kbd className="keycap">W</kbd>
                <kbd className="keycap">A</kbd>
                <kbd className="keycap">S</kbd>
                <kbd className="keycap">D</kbd>
              </span>
              <span className="ctl-label">Move</span>
            </span>
            <span className="ctl-sep" />
            <span className="flex items-center gap-2">
              <span className="keycap">Mouse</span>
              <span className="ctl-label">Look</span>
            </span>
            <span className="ctl-sep" />
            <span className="flex items-center gap-2">
              <kbd className="keycap">Esc</kbd>
              <span className="ctl-label">Exit</span>
            </span>
          </div>
        </div>
      )}

      <main className="relative z-10">
        {/* Scroll zone: dust -> mountain, then cinematic crane-orbit */}
        <div
          style={{
            // The WORK gallery is arrow-driven, so it has NO scroll zone.
            height: phase === "projects" ? "100vh" : `${scrollVh}vh`,
            pointerEvents: "none",
          }}
          aria-hidden
        />
      </main>

      <Preloader onComplete={() => setEntered(true)} />
    </>
  );
}
