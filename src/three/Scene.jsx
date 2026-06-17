import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { useRef, useMemo, useEffect, Suspense } from "react";
import MountainCloud from "./MountainCloud.jsx";
import Portal from "./Portal.jsx";
import ProjectsCloud from "./ProjectsCloud.jsx";
import { Collider, FreeRoam } from "./FreeRoam.jsx";
import { smoothstep } from "./grainShader.js";

// Global dust density — keep it tasteful so the mountain reads as elegant dust,
// not a solid mass. House visibility comes from local densification, not this.
const PARTICLE_COUNT = 160000;

// Portal 1: inside the home, slightly right of center (half the previous nudge).
const PORTAL_POS = [-4.8, -11.3, 4.0];
const PORTAL_ROT = [0, Math.PI / 12, 0]; // 15° yaw to sit parallel to the wall
// Portal 2: at the far end of the water bridge, same height (-> destination TBD).
// Nudged right and yawed so it stands PERPENDICULAR across the bridge.
const PORTAL2_POS = [-6.8, -11.3, 11.1]; // on the bridge itself (mid-span center)
const PORTAL2_ROT = [0, -Math.PI / 4, 0];
// Resting camera pose when you step back out of the WORK portal (return from the
// projects section): stand just in front of it, gazing at it — not the wide hero shot.
const PORTAL_REST_POS = new THREE.Vector3(1.0, -8.6, 10.0);
const PORTAL_REST_LOOK = new THREE.Vector3(-4.8, -10.6, 4.0);
const WARP_DURATION = 3.6; // slow, graceful dive-through + arc-out to the projects vantage
const ENTER_DIST = 4.5; // how close (walking) you must be to enter

// Settled camera vantages for each section (the warp flight ends here, and the
// section then holds this pose). WORK frames the mountain flat from +X; ABOUT
// reuses the SAME mountain but rotated (below) and viewed from a 3/4 angle so it
// reads as a different place.
const PROJ_VIEW_POS = new THREE.Vector3(145, -6, 0);
const PROJ_VIEW_LOOK = new THREE.Vector3(0, 9, 0);
const PROJ_VIEW_FOV = 22;
// Person-on-the-ground perspective: stand close to the base and gaze UP at the
// towering peaks, with a natural (wide-ish) FOV so it feels human, not telephoto.
const ABOUT_VIEW_POS = new THREE.Vector3(14, -8, 66); // stand ON the ground, near the base
const ABOUT_VIEW_LOOK = new THREE.Vector3(0, 24, 0);  // gaze UP at the towering peaks
const ABOUT_VIEW_FOV = 54;
// Rotation applied to the ABOUT mountain to give the camera a different view.
const ABOUT_ROT = [0, Math.PI * 0.4, 0];

const lerp = (a, b, t) => a + (b - a) * t;

// Valley floor (cottage) sits at y ~ -11; small eye height so the peaks feel
// huge and the viewer reads as human-scale rather than a giant.
const GROUND_Y = -11;
const EYE_H = 1.7;
const PERSON_POS = new THREE.Vector3(12, GROUND_Y + EYE_H, 18);

// The model is only "complete" from inside the valley, so the whole cinematic
// stays within the bowl and always looks inward — never revealing the broken
// exterior. We orbit on the near (+z) side around the cottage and settle to the
// first-person standpoint. Angles are kept so the orbit ends exactly at the
// person position for a seamless hand-off.
const INNER_LOOK = new THREE.Vector3(0, -4, 0); // look across the valley interior
// Cinematic resting pose: a low-angle hero shot — camera sits low in the valley
// and gazes UP at the towering peaks. Clicking "walk" swoops down to standpoint.
const HERO_POS = new THREE.Vector3(11, -3, 22);
const HERO_LOOK = new THREE.Vector3(-6, 3, -13);
const ORBIT_R = 24;
const ANG_END = Math.atan2(PERSON_POS.x, PERSON_POS.z); // person bearing
// Enter the valley on the person's bearing, then do a full interior loop that
// ends back on that bearing for a seamless hand-off to the walk standpoint.
const ENTER_POS = new THREE.Vector3(
  Math.sin(ANG_END) * 24,
  1,
  Math.cos(ANG_END) * 24
);
const ORBIT_END_POS = new THREE.Vector3(
  Math.sin(ANG_END) * ORBIT_R,
  -2,
  Math.cos(ANG_END) * ORBIT_R
);

// One camera director for every phase: home cinematic -> portal dive -> projects.
function Director({
  phaseRef,
  sRef,
  roam,
  warpRef,
  warpTargetRef,
  revealRef,
  projScrollRef,
  projIntroRef,
  portalAppearRef,
  atPortalRef,
  onWarpDone,
}) {
  const { camera, pointer } = useThree();
  const curLook = useRef(new THREE.Vector3(0, 0, -10));
  const P = useRef(new THREE.Vector3());
  const L = useRef(new THREE.Vector3());
  const portalV = useMemo(() => new THREE.Vector3(...PORTAL_POS), []);
  const portal2V = useMemo(() => new THREE.Vector3(...PORTAL2_POS), []);

  useFrame((state, delta) => {
    const phase = phaseRef.current;
    const t = state.clock.elapsedTime;
    const p = P.current;
    const l = L.current;

    if (phase === "projects") {
      // Telephoto / flat look: a narrow FOV from far back compresses depth so
      // the slides, the mountain and the camera plane all read as parallel.
      // EASE into it (don't snap) so the dive's wide FOV blends smoothly down to
      // 22 — this is half of why the portal->work hand-off feels continuous.
      if (Math.abs(camera.fov - 22) > 0.02) {
        camera.fov += (22 - camera.fov) * (1 - Math.pow(0.025, delta));
        camera.updateProjectionMatrix();
      }
      // Assemble the mountain from dust as we emerge from the portal. A touch
      // slower so the particle formation reads as the transition itself.
      revealRef.current = Math.min(1, revealRef.current + delta / 2.1);
      // Automatic intro fly-in (no orbit): glide straight in while dust forms.
      if (projIntroRef) projIntroRef.current = Math.min(1, projIntroRef.current + delta / 1.9);
      const intro = projIntroRef ? smoothstep(0, 1, projIntroRef.current) : 1;
      // Camera is STATIC once the intro lands; scrolling drives the gallery.
      // Far distance + narrow FOV keeps the same framing but flattens depth.
      const R = lerp(310, 145, intro);
      p.set(R, lerp(4, -6, intro), 0);
      l.set(0, lerp(13, 9, intro), 0);
      portalAppearRef.current = 0;
    } else if (phase === "about") {
      // Same mountain, new angle. Ease into the ABOUT framing and hold it while
      // the dust finishes assembling (the warp already flew us most of the way).
      if (Math.abs(camera.fov - ABOUT_VIEW_FOV) > 0.02) {
        camera.fov += (ABOUT_VIEW_FOV - camera.fov) * (1 - Math.pow(0.025, delta));
        camera.updateProjectionMatrix();
      }
      revealRef.current = Math.min(1, revealRef.current + delta / 2.1);
      p.copy(ABOUT_VIEW_POS);
      l.copy(ABOUT_VIEW_LOOK);
      portalAppearRef.current = 0;
    } else {
      // Restore the cinematic FOV for the home / portal scenes.
      if (Math.abs(camera.fov - 60) > 0.01) {
        camera.fov = 60;
        camera.updateProjectionMatrix();
      }
      // ---- Home cinematic path ----
      if (roam.current) {
        portalAppearRef.current = 1; // keep the portal visible while walking
        return; // walk mode owns the camera
      }
      // Returned from projects: rest right in front of the WORK portal you came
      // from (instead of the wide hero shot at the start of the cinematic).
      if (atPortalRef && atPortalRef.current && phase !== "warp") {
        p.copy(PORTAL_REST_POS);
        p.x += Math.sin(t * 0.1) * 0.4;
        p.y += Math.sin(t * 0.16) * 0.25;
        l.copy(PORTAL_REST_LOOK);
        portalAppearRef.current = 1;
        const damp0 = 1 - Math.pow(0.0012, delta);
        camera.position.lerp(p, damp0);
        curLook.current.lerp(l, damp0);
        camera.lookAt(curLook.current);
        return;
      }
      const s = sRef ? sRef.current : 0;
      if (s < 0.12) {
        p.set(pointer.x * 3 + Math.sin(t * 0.1) * 0.6, pointer.y * 2 + 0.5, 30);
        l.set(0, 0, -10);
      } else if (s < 0.5) {
        const k = smoothstep(0, 1, (s - 0.12) / 0.38);
        p.lerpVectors(new THREE.Vector3(0, 0.5, 30), ENTER_POS, k);
        l.lerpVectors(new THREE.Vector3(0, 0, -10), INNER_LOOK, k);
      } else if (s < 0.8) {
        const k = smoothstep(0, 1, (s - 0.5) / 0.3);
        const ang = ANG_END + k * Math.PI * 2.0;
        const R = lerp(24, ORBIT_R, k);
        const h = lerp(1, -2, k) + Math.sin(k * Math.PI * 2.0) * 3.5;
        p.set(Math.sin(ang) * R, h, Math.cos(ang) * R);
        l.copy(INNER_LOOK);
      } else {
        const k = smoothstep(0, 1, (s - 0.8) / 0.2);
        p.lerpVectors(ORBIT_END_POS, HERO_POS, k);
        p.x += Math.sin(t * 0.1) * 1.0 * k;
        p.y += Math.sin(t * 0.16) * 0.5 * k;
        p.z -= (1 - Math.cos(t * 0.08)) * 1.5 * k;
        l.lerpVectors(INNER_LOOK, HERO_LOOK, k);
      }

      // Portal fades in toward the end of the cinematic so it's clickable there.
      portalAppearRef.current = roam.current ? 0 : smoothstep(0.82, 0.97, s);

      if (phase === "warp") {
        warpRef.current = Math.min(1, warpRef.current + delta / WARP_DURATION);
        const w = warpRef.current;

        // ONE continuous flight, no cut: dive toward/through the portal, then
        // arc OUT to the projects vantage. Meanwhile the home grains spiral into
        // the portal and fade (MountainCloud) while the projects dust assembles
        // the new mountain in the SAME origin space — a true particle blend.
        //
        // The two phases DON'T overlap and both ease at the shared apex (0.45),
        // so the camera velocity glides through zero there — no jank/kink in the
        // zoom-in -> zoom-out reversal.
        const inT = smoothstep(0.0, 0.45, w); // dive into the portal core
        const outT = smoothstep(0.45, 1.0, w); // pull back to the section framing

        // Which portal we dive into and which vantage we arc out to depends on
        // the section the warp is leading to (WORK vs ABOUT).
        const toAbout = warpTargetRef && warpTargetRef.current === "about";
        const divePortal = toAbout ? portal2V : portalV;
        const endP = toAbout ? ABOUT_VIEW_POS : PROJ_VIEW_POS;
        const endL = toAbout ? ABOUT_VIEW_LOOK : PROJ_VIEW_LOOK;
        const endFov = toAbout ? ABOUT_VIEW_FOV : PROJ_VIEW_FOV;

        const diveP = divePortal.clone().add(new THREE.Vector3(0, 0, 4 - 7 * inT));
        p.copy(diveP).lerp(endP, outT);
        l.copy(divePortal).lerp(endL, outT);

        // Section mountain forms from dust during the pull-out (visible morph).
        revealRef.current = smoothstep(0.4, 1.0, w);

        // FOV: a single continuous curve — slight wide whoosh on the dive, then
        // eases to the section's flat FOV on the pull-out (no conditional pop).
        const fov = lerp(lerp(60, 76, inT), endFov, outT);
        if (Math.abs(camera.fov - fov) > 0.02) {
          camera.fov = fov;
          camera.updateProjectionMatrix();
        }

        // Fade BOTH portals out right at the START of the dive (they're solid
        // discs, so they look odd up close). They're fully gone well before the
        // zoom-out, leaving only flowing particles.
        portalAppearRef.current = 1 - smoothstep(0.0, 0.28, w);
        if (w >= 1) onWarpDone();
      }
    }

    const damp = 1 - Math.pow(0.0012, delta);
    camera.position.lerp(p, damp);
    curLook.current.lerp(l, damp);
    camera.lookAt(curLook.current);
  });

  return null;
}

// In walk mode R3F pointer events don't fire (pointer is locked), so we detect
// proximity to whichever portal you're standing at and let a plain click or
// the Enter key trigger entry. Reports the portal's label upward so the UI
// can show a contextual "ENTER WORK" / "ENTER ABOUT" prompt.
function PortalInteractor({ phaseRef, roamRef, portals, onNearChange }) {
  const { camera } = useThree();
  const nearFn = useRef(null); // onEnter of the portal you're standing at, or null
  const nearLabel = useRef(null);

  useFrame(() => {
    const active = phaseRef.current === "home" && roamRef.current;
    let hit = null;
    let hitLabel = null;
    if (active) {
      for (const pp of portals) {
        if (camera.position.distanceTo(pp.v) <= ENTER_DIST) {
          hit = pp.onEnter;
          hitLabel = pp.label || "";
          break;
        }
      }
    }
    if (hitLabel !== nearLabel.current) onNearChange && onNearChange(hitLabel);
    nearFn.current = hit;
    nearLabel.current = hitLabel;
  });

  useEffect(() => {
    const fire = () => {
      if (nearFn.current && phaseRef.current === "home") nearFn.current();
    };
    const onDown = () => fire();
    const onKey = (e) => {
      // Enter (main row or numpad) -> walk through the portal you're near.
      if ((e.code === "Enter" || e.code === "NumpadEnter") && nearFn.current && phaseRef.current === "home") {
        e.preventDefault();
        fire();
        return;
      }
      // Dev helper: press P while walking to log where you're standing.
      if (e.code === "KeyP" && roamRef.current) {
        const p = camera.position;
        console.log(`[portal-place] = [${p.x.toFixed(2)}, ${(p.y - 0.6).toFixed(2)}, ${p.z.toFixed(2)}]`);
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [phaseRef, roamRef, camera]);

  return null;
}

export default function Scene({
  sRef,
  roam = false,
  phase = "home",
  phaseRef,
  warpRef,
  revealRef,
  projScrollRef,
  projIntroRef,
  atPortalRef,
  roamLanding,
  roamLookAt,
  roamEntryFrom,
  roamPoseRef,
  activeCat,
  warpTarget = "projects",
  warpTargetRef,
  onEnterPortal,
  onEnterPortal2,
  onWarpDone,
  onNearPortal,
}) {
  const colliderRef = useRef(null);
  const roamRef = useRef(roam);
  roamRef.current = roam;
  const portalAppearRef = useRef(0);
  const showHome = phase === "home" || phase === "warp";
  // During the warp only the TARGET section's cloud is mounted (so it forms from
  // dust as we emerge); after, the active section's cloud stays.
  const showProjects =
    phase === "projects" || (phase === "warp" && warpTarget === "projects");
  const showAbout =
    phase === "about" || (phase === "warp" && warpTarget === "about");
  // The home dust spirals into whichever portal this warp is diving into.
  const warpPortal = warpTarget === "about" ? PORTAL2_POS : PORTAL_POS;
  const portals = useMemo(
    () => [
      { v: new THREE.Vector3(...PORTAL_POS), onEnter: onEnterPortal, label: "WORK" },
      { v: new THREE.Vector3(...PORTAL2_POS), onEnter: onEnterPortal2 || (() => {}), label: "ABOUT" },
    ],
    [onEnterPortal, onEnterPortal2]
  );

  return (
    <Canvas
      camera={{ position: [0, 0, 30], fov: 60, near: 0.1, far: 900 }}
      gl={{
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      dpr={[1, 1.5]}
    >
      {/* In ABOUT we drop the opaque scene background so the DOM glass card
          behind the canvas shows through, with the mountain particles in front. */}
      {phase !== "about" && <color attach="background" args={["#040405"]} />}

      <Suspense fallback={null}>
        {showHome && (
          <>
            <MountainCloud
              count={PARTICLE_COUNT}
              sRef={sRef}
              roam={roam}
              warpRef={warpRef}
              portal={warpPortal}
            />
            <Collider colliderRef={colliderRef} />
            <Portal
              position={PORTAL_POS}
              rotation={PORTAL_ROT}
              appearRef={portalAppearRef}
              onEnter={onEnterPortal}
              label="WORK"
              roam={roam}
            />
            <Portal
              position={PORTAL2_POS}
              rotation={PORTAL2_ROT}
              appearRef={portalAppearRef}
              onEnter={onEnterPortal2}
              label="ABOUT"
              roam={roam}
            />
            <PortalInteractor
              phaseRef={phaseRef}
              roamRef={roamRef}
              portals={portals}
              onNearChange={onNearPortal}
            />
          </>
        )}
        {showProjects && <ProjectsCloud count={PARTICLE_COUNT} progressRef={revealRef} />}
        {showAbout && (
          <ProjectsCloud count={PARTICLE_COUNT} progressRef={revealRef} rotation={ABOUT_ROT} />
        )}
      </Suspense>

      <Director
        phaseRef={phaseRef}
        sRef={sRef}
        roam={roamRef}
        warpRef={warpRef}
        warpTargetRef={warpTargetRef}
        revealRef={revealRef}
        projScrollRef={projScrollRef}
        projIntroRef={projIntroRef}
        portalAppearRef={portalAppearRef}
        atPortalRef={atPortalRef}
        onWarpDone={onWarpDone}
      />
      <FreeRoam
        enabled={roam && phase === "home"}
        colliderRef={colliderRef}
        eyeHeight={1.7}
        speed={6}
        landing={roamLanding || PERSON_POS}
        landingLookAt={roamLookAt || null}
        entryFrom={roamEntryFrom || null}
        entryDur={roamEntryFrom ? 1.0 : 1.7}
        poseRef={roamPoseRef}
      />

      <EffectComposer>
        <Bloom
          intensity={0.7}
          luminanceThreshold={0.15}
          luminanceSmoothing={0.4}
          mipmapBlur
          radius={0.5}
        />
        <Vignette eskil={false} offset={0.45} darkness={0.7} />
      </EffectComposer>
    </Canvas>
  );
}
