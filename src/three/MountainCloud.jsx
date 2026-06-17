import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as THREE from "three";
import { grainFragment, pickColor, smoothstep } from "./grainShader.js";

export const MOUNT_CENTER = new THREE.Vector3(0, 0, 0);
export const MOUNT_SIZE = 120;

// The model's parts are generically named (TextureMaterial_N). These are the
// materials that map to the original "ym2_loghouse" textures (the house),
// resolved by content-matching the source textures -> determined offline.
// Only the tight, co-located cabin materials (target center ~(-5.4,-10.3,4),
// extents just a few units). Excludes the spread foliage atlas (_23), the stone
// wall (_24) and the whole-model backside atlas (_32) that were mis-matched.
const HOUSE_MATERIALS = new Set([
  "TextureMaterial", // bridge base/deck (ym2_brige) by the cabin
  "TextureMaterial_1", // chimney (small ishikabe stone at the cabin)
  "TextureMaterial_3",
  "TextureMaterial_7",
  "TextureMaterial_10",
  "TextureMaterial_13",
  "TextureMaterial_15",
  "TextureMaterial_21",
  "TextureMaterial_24",
  "TextureMaterial_27",
  "TextureMaterial_29",
]);

// DEBUG: set true to render ONLY the house grains (to confirm the location),
// then set back to false to restore the full scene.
const DEBUG_HOUSE_ONLY = false;

// DEBUG PROBE: set to a single material name (e.g. "TextureMaterial_20") to
// glow ONLY that material amber, in full scene, so we can find which part it is.
// Leave "" for normal behaviour. Candidates for the stairs/platform:
//   _20 (tall thin), _17 (stone ground), _2 / _19 / _26 / _30 (yuka floors).
const PROBE_MATERIAL = "";

// Extra grains placed locally on the loghouse meshes so the home reads as a
// structure — WITHOUT inflating the whole scene's density.
const HOUSE_DENSIFY = 16000;

// Safety location gate: only cabin-material grains within this radius (WORLD
// units) of the cabin cluster get amber, so any stray far face never glows.
const HOUSE_RADIUS = 10;

// The wooden porch deck + front ramp/stairs use TextureMaterial_23 (sawn-wood
// planks). That mesh also reaches nearby tree trunks, so we highlight it with a
// TIGHT radius around the cabin — just the deck/ramp, never the far trunks.
const DECK_MATERIALS = new Set(["TextureMaterial_23"]);
const DECK_RADIUS = 6.5;

// Cursor-ray repulsion (WORLD units; model is sized via MOUNT_SIZE = 120). Tune
// these until the tunnel is clearly visible in both the hero dust and mountain.
const RAY_RADIUS = 6;
const RAY_STRENGTH = 1.6;

// Atmospheric depth (view-space distance in WORLD units; mountain ~MOUNT_SIZE=120).
// A TIGHT band so there's a clear near->far gradient across the mountain:
// fully sharp within NEAR_FADE, melted into the dark by FAR_FADE.
const NEAR_FADE = 40; // crisp/bright within this distance
const FAR_FADE = 200; // ~invisible beyond this distance
const BRIGHT_FLOOR = 0.32; // how dim the farthest visible grains get (0..1)
const HAZE_DENSITY = 0.0035; // subtle exponential haze on top (0 = off)
const DISSOLVE_W = 0.16; // softness of the per-grain noise dissolve

// Grain sizes: current top size stays the MAX; a power-law skew puts most grains
// far smaller/finer below it. (uSize 1.7 and the 3.6 clamp are unchanged, so
// nothing renders larger than before.)
const MAX_SCALE = 1.85; // == previous largest aScale
const MIN_SCALE = 0.3; // floor so fine grains never vanish to nothing
const SIZE_EXP = 2.5; // higher -> more grains pushed toward MIN_SCALE

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uNearFade;   // sharp within this view distance
  uniform float uFarFade;    // faded out by this view distance
  uniform float uBrightFloor;// brightness of the farthest visible grains
  uniform float uDensity;    // exponential haze strength
  uniform float uDissolveW;  // softness of the per-grain noise dissolve
  uniform float uProgress;
  uniform vec3 uRayOrigin;  // cursor ray origin (world)
  uniform vec3 uRayDir;     // cursor ray direction (world, normalized)
  uniform float uMouseActive; // 0 until pointer first moves / off during roam
  uniform float uMouseSpeed;  // pointer speed (for a subtle wake)
  uniform float uRadius;    // repulsion radius in WORLD units
  uniform float uStrength;  // repulsion push in WORLD units
  uniform float uWarp;      // 0..1 portal suck-in transition
  uniform vec3 uPortal;     // portal world position to collapse toward

  attribute float aScale;
  attribute float aBright;
  attribute float aPhase;
  attribute float aDelay;
  attribute float aHeroVis;
  attribute float aIsHouse;
  attribute vec3 aColor;
  attribute vec3 aTargetColor;
  attribute vec3 aTarget;

  uniform float uHouseOnly; // debug: show only the house grains

  varying float vBright;
  varying float vAlpha;
  varying float vTwinkle;
  varying vec3 vColor;

  void main() {
    // Per-particle staggered morph: low (aDelay~0) assembles first so the
    // mountain rises from its base upward for an organic transition.
    float window = 0.7;
    float d = aDelay * window;
    float lp = clamp((uProgress - d) / max(1.0 - window, 0.001), 0.0, 1.0);
    float ease = smoothstep(0.0, 1.0, lp);
    vec3 morphed = mix(position, aTarget, ease);

    // How "in transit" a grain is (0 at dust/mountain ends, 1 mid-morph).
    float transit = ease * (1.0 - ease) * 4.0;

    float ph = aPhase;
    float amp = (0.09 + aScale * 0.05) * (1.0 - ease * 0.6);
    morphed.x += sin(uTime * 2.4 + ph) * amp;
    morphed.y += cos(uTime * 2.1 + ph * 1.3) * amp;
    morphed.z += sin(uTime * 1.8 + ph * 0.7) * amp * 0.6;

    // --- Hero-only art direction (fades out as the morph begins) ---
    float heroMask = 1.0 - smoothstep(0.0, 0.25, uProgress);
    // Gentle large-scale flow so the whole field drifts like suspended mist.
    morphed.x += sin(uTime * 0.06 + position.y * 0.025) * 1.4 * heroMask;
    morphed.y += sin(uTime * 0.05 + position.x * 0.02) * 0.7 * heroMask;

    // --- World-space cursor influence (always on, every stage) ---
    // Permanent fix: keep this visual-only. Position displacement created a
    // visible tunnel/"black hole", so we compute influence for shading only.
    vec3 toP = morphed - uRayOrigin;
    float along = dot(toP, uRayDir);
    vec3 closest = uRayOrigin + uRayDir * max(along, 0.0);
    vec3 away = morphed - closest;
    float rd = length(away);
    float rayInfl = smoothstep(uRadius, 0.0, rd) * uMouseActive;

    // Portal black-hole suck-in: the whole field gently SPIRALS into the portal
    // and eases inward, as if calmly devoured by a black hole.
    float warpBright = 0.0;
    if (uWarp > 0.0001) {
      vec3 toPortal = uPortal - morphed;
      float pd = length(toPortal);
      vec3 dir = pd > 1e-4 ? toPortal / pd : vec3(0.0);
      // Smooth, calm tangential swirl — eases in with the warp, no harsh spikes.
      vec3 tangent = normalize(cross(vec3(0.0, 0.0, 1.0), dir) + vec3(1e-5));
      float swirlAmt = smoothstep(0.0, 1.0, uWarp) * 2.2;
      morphed += tangent * swirlAmt;
      // Smooth accelerated collapse toward the portal (cubic ease for calm start).
      float pull = smoothstep(0.0, 1.0, uWarp);
      pull = pull * pull * pull;
      morphed = mix(morphed, uPortal, pull);
      // Soft accretion glow as grains stream in, before they're absorbed.
      warpBright = smoothstep(50.0, 6.0, pd) * smoothstep(0.0, 0.5, uWarp) * 1.1;
    }

    vec4 mvPosition = modelViewMatrix * vec4(morphed, 1.0);
    float dist = -mvPosition.z;

    vTwinkle = 0.65 + 0.35 * sin(uTime * 1.1 + aPhase);
    // Atmospheric depth: a tight near->far band so distant grains dissolve into
    // the dark background while near grains stay crisp and bright. Additive
    // blending means lowering alpha/brightness is what makes them recede.
    float depth = smoothstep(uFarFade, uNearFade, dist); // 1 near -> 0 far
    depth *= exp(-dist * uDensity);                       // subtle extra haze
    float nearFade = smoothstep(0.6, 4.5, dist);          // don't smother the lens

    // Granular dissolve: each grain has its own threshold (from aPhase), so as
    // depth drops the far grains drop out INDIVIDUALLY rather than fading flat.
    float seed = fract(aPhase * 0.1591549431);            // aPhase/(2pi) -> 0..1
    float dissolve = smoothstep(seed - uDissolveW, seed + uDissolveW, depth);

    // Compose the hero frame: clean negative space up top, dust weighted to the
    // lower screen and brighter near the floor.
    float vy = position.y;
    float topFade = mix(1.0, pow(1.0 - smoothstep(-12.0, 24.0, vy), 1.6), heroMask);
    float botBoost = mix(1.0, 1.0 + smoothstep(20.0, -54.0, vy) * 0.7, heroMask);

    // Keep the hero sparse and elegant: only a fraction of grains are lit as dust;
    // the rest fade in as the field gathers into the mountain.
    float visMask = mix(1.0, smoothstep(0.66, 0.78, aHeroVis), heroMask);

    // Dim grains while they converge so the mid-morph never piles into a dense
    // bright clump; full brightness as dust and as the settled mountain.
    vAlpha = dissolve * nearFade * (1.0 - 0.5 * transit) * topFade * visMask;
    vBright = aBright * (1.0 + ease * 0.25) * (1.0 - 0.4 * transit) * botBoost;
    vBright *= mix(uBrightFloor, 1.0, depth); // far grains dim into the haze
    vBright *= 1.0 + rayInfl * 0.35;          // gentle brighten near the cursor
    vBright *= 1.0 + warpBright;              // accretion glow as grains stream in
    // Fade the home out only in the LAST stretch of the warp, so the spiral
    // stream stays visible being absorbed rather than vanishing immediately.
    vAlpha *= 1.0 - smoothstep(0.6, 1.0, uWarp);

    // Hero stays cool/monochrome; as the field gathers into the mountain the
    // grains take on the model's real colors (green trees, the house, terrain).
    float depthT = smoothstep(20.0, uFarFade, dist);
    vec3 heroCol = mix(aColor, vec3(0.5, 0.62, 0.85), depthT * 0.35 * heroMask);
    vColor = mix(heroCol, aTargetColor, ease);

    vec4 clip = projectionMatrix * mvPosition;

    // Debug: hide everything except the house grains.
    if (uHouseOnly > 0.5) vAlpha *= aIsHouse;

    gl_PointSize = uSize * aScale * uPixelRatio * (70.0 / dist);
    gl_PointSize *= mix(0.45, 1.0, depth); // far grains shrink with the haze too
    gl_PointSize = clamp(gl_PointSize, 0.0, 3.6);
    gl_Position = clip;
  }
`;

function buildMergedGeometry(scene) {
  const geos = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (o.isMesh && o.geometry) {
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      const ng = new THREE.BufferGeometry();
      ng.setAttribute("position", g.getAttribute("position").clone());
      geos.push(ng);
    }
  });
  if (geos.length === 0) return null;
  return geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Approximate world-space surface area (subsampled) for proportional sampling.
function meshWorldArea(m) {
  const pos = m.geometry.attributes.position;
  if (!pos) return 0;
  const idx = m.geometry.index;
  const tris = idx ? idx.count / 3 : pos.count / 3;
  const step = tris > 12000 ? Math.ceil(tris / 12000) : 1;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  let area = 0;
  for (let t = 0; t < tris; t += step) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld);
    b.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld);
    c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    area += ab.cross(ac).length() * 0.5;
  }
  return area * step;
}

export default function MountainCloud({
  count = 200000,
  sRef,
  roam = false,
  warpRef,
  portal = [0, 0, 0],
}) {
  const matRef = useRef();
  const pointerReady = useRef(false);
  const lastP = useRef({ x: 0, y: 0 });
  const raycaster = useRef(new THREE.Raycaster());
  const { scene } = useGLTF("/models/mountain.glb");

  // Permanent fix for post-walk "hole":
  // after pointer-lock changes (esp. exiting walk), keep cursor interaction OFF
  // until a real unlocked mousemove occurs. This avoids stale pointer rays.
  useEffect(() => {
    const onMove = () => {
      if (!document.pointerLockElement) pointerReady.current = true;
    };
    const onLockChange = () => {
      pointerReady.current = false;
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("pointerlockchange", onLockChange);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("pointerlockchange", onLockChange);
    };
  }, []);

  useEffect(() => {
    // Any roam toggle requires a fresh unlocked move before re-activating
    // cursor-ray repulsion.
    pointerReady.current = false;
  }, [roam]);

  const { positions, scales, brights, phases, delays, heroVis, isHouse, colors, targetColors, targets } =
    useMemo(() => {
      const positions = new Float32Array(count * 3);
      const scales = new Float32Array(count);
      const brights = new Float32Array(count);
      const phases = new Float32Array(count);
      const delays = new Float32Array(count);
      const heroVis = new Float32Array(count);
      const isHouse = new Float32Array(count);
      const colors = new Float32Array(count * 3);
      const targetColors = new Float32Array(count * 3);
      const targets = new Float32Array(count * 3);

      // Bounds/scale from the whole model so target placement matches the camera.
      const merged = buildMergedGeometry(scene);
      const center = new THREE.Vector3();
      let scale = 1;
      if (merged) {
        merged.computeBoundingBox();
        const bb = merged.boundingBox;
        bb.getCenter(center);
        const size = new THREE.Vector3();
        bb.getSize(size);
        scale = MOUNT_SIZE / Math.max(size.x, size.y, size.z);
      }

      // Collect meshes; identify the house by MATERIAL IDENTITY (loghouse), not
      // by colour guessing.
      scene.updateMatrixWorld(true);
      const meshes = [];
      scene.traverse((o) => {
        if (o.isMesh && o.geometry) meshes.push(o);
      });
      const isHouseMesh = (m) => {
        const mat = m.material;
        if (!mat) return false;
        const names = Array.isArray(mat) ? mat.map((x) => x && x.name) : [mat.name];
        return names.some((nm) => nm && (/loghouse/i.test(nm) || HOUSE_MATERIALS.has(nm)));
      };
      const isDeckMesh = (m) => {
        const mat = m.material;
        if (!mat) return false;
        const names = Array.isArray(mat) ? mat.map((x) => x && x.name) : [mat.name];
        return names.some((nm) => nm && DECK_MATERIALS.has(nm));
      };
      const houseMeshes = meshes.filter(isHouseMesh);
      const areas = meshes.map(meshWorldArea);
      const totalArea = areas.reduce((a, b) => a + b, 0) || 1;

      // Reserve a block for LOCAL house densification; distribute the rest by area.
      const densify = houseMeshes.length ? Math.min(HOUSE_DENSIFY, Math.floor(count * 0.12)) : 0;
      const baseCount = count - densify;

      const tmp = new THREE.Vector3();
      const lhPts = []; // loghouse-material grain positions (cabin + trunks)
      const lhIdx = []; // their grain indices
      const deckIdx = []; // wooden deck/ramp grains (gated tight to the cabin)
      const probeIdx = []; // debug: grains of PROBE_MATERIAL
      let written = 0;
      for (let mi = 0; mi < meshes.length; mi++) {
        const m = meshes[mi];
        const house = isHouseMesh(m);
        const deck = isDeckMesh(m);
        let n =
          mi === meshes.length - 1
            ? baseCount - written
            : Math.round((baseCount * areas[mi]) / totalArea);
        if (n <= 0) continue;
        if (written + n > baseCount) n = baseCount - written;

        const sampler = new MeshSurfaceSampler(m).build();
        for (let k = 0; k < n; k++) {
          const gi = written + k;
          sampler.sample(tmp);
          tmp.applyMatrix4(m.matrixWorld).sub(center).multiplyScalar(scale).add(MOUNT_CENTER);
          targets[gi * 3] = tmp.x;
          targets[gi * 3 + 1] = tmp.y;
          targets[gi * 3 + 2] = tmp.z;
          isHouse[gi] = 0; // tagged after we locate the cabin cluster
          if (house) {
            lhPts.push(tmp.x, tmp.y, tmp.z);
            lhIdx.push(gi);
          } else if (deck) {
            deckIdx.push(gi);
          }
          if (PROBE_MATERIAL && m.material && m.material.name === PROBE_MATERIAL) {
            probeIdx.push(gi);
          }
        }
        written += n;
      }
      for (let gi = written; gi < baseCount; gi++) {
        const s = (gi - 1) * 3;
        targets[gi * 3] = targets[s];
        targets[gi * 3 + 1] = targets[s + 1];
        targets[gi * 3 + 2] = targets[s + 2];
        isHouse[gi] = 0;
      }

      // Locate the cabin: tighten onto the densest loghouse cluster so scattered
      // tree trunks (same log texture) don't pull the centre off the house.
      const houseCenter = new THREE.Vector3();
      let houseFound = false;
      if (lhPts.length >= 30) {
        const cen = (c0, rad) => {
          let sx = 0, sy = 0, sz = 0, cnt = 0;
          for (let i = 0; i < lhPts.length; i += 3) {
            if (c0) {
              const dx = lhPts[i] - c0.x, dy = lhPts[i + 1] - c0.y, dz = lhPts[i + 2] - c0.z;
              if (dx * dx + dy * dy + dz * dz > rad * rad) continue;
            }
            sx += lhPts[i]; sy += lhPts[i + 1]; sz += lhPts[i + 2]; cnt++;
          }
          return cnt ? new THREE.Vector3(sx / cnt, sy / cnt, sz / cnt) : null;
        };
        let c = cen(null, 0);
        c = cen(c, HOUSE_RADIUS * 2.4) || c;
        c = cen(c, HOUSE_RADIUS * 1.5) || c;
        c = cen(c, HOUSE_RADIUS) || c;
        if (c) {
          houseCenter.copy(c);
          houseFound = true;
        }
      }

      // Tag base loghouse grains as house ONLY if within the cabin radius.
      const hr2 = HOUSE_RADIUS * HOUSE_RADIUS;
      if (houseFound) {
        for (let j = 0; j < lhIdx.length; j++) {
          const gi = lhIdx[j];
          const o = gi * 3;
          const dx = targets[o] - houseCenter.x;
          const dy = targets[o + 1] - houseCenter.y;
          const dz = targets[o + 2] - houseCenter.z;
          if (dx * dx + dy * dy + dz * dz <= hr2) isHouse[gi] = 1;
        }
        // Wooden deck + ramp/stairs: only the deck-wood grains tight to the cabin.
        const dr2 = DECK_RADIUS * DECK_RADIUS;
        for (let j = 0; j < deckIdx.length; j++) {
          const gi = deckIdx[j];
          const o = gi * 3;
          const dx = targets[o] - houseCenter.x;
          const dy = targets[o + 1] - houseCenter.y;
          const dz = targets[o + 2] - houseCenter.z;
          if (dx * dx + dy * dy + dz * dz <= dr2) isHouse[gi] = 1;
        }
      }

      // Local densification: redirect the reserved block onto the cabin only
      // (loghouse meshes near the cabin, rejection-sampled within the radius).
      if (densify > 0 && houseFound) {
        const Cw = houseCenter.clone().sub(MOUNT_CENTER).divideScalar(scale).add(center);
        const Rw = HOUSE_RADIUS / scale;
        const nearMeshes = houseMeshes.filter(
          (m) => new THREE.Box3().setFromObject(m).distanceToPoint(Cw) <= Rw
        );
        const useMeshes = nearMeshes.length ? nearMeshes : houseMeshes;
        const hSamplers = useMeshes.map((m) => new MeshSurfaceSampler(m).build());
        for (let gi = baseCount; gi < count; gi++) {
          let placed = false;
          for (let attempt = 0; attempt < 24; attempt++) {
            const si = (Math.random() * hSamplers.length) | 0;
            hSamplers[si].sample(tmp);
            tmp.applyMatrix4(useMeshes[si].matrixWorld).sub(center).multiplyScalar(scale).add(MOUNT_CENTER);
            if (tmp.distanceTo(houseCenter) <= HOUSE_RADIUS) {
              placed = true;
              break;
            }
          }
          if (!placed) {
            tmp.set(
              houseCenter.x + (Math.random() - 0.5) * HOUSE_RADIUS,
              houseCenter.y + (Math.random() - 0.5) * HOUSE_RADIUS,
              houseCenter.z + (Math.random() - 0.5) * HOUSE_RADIUS
            );
          }
          targets[gi * 3] = tmp.x;
          targets[gi * 3 + 1] = tmp.y;
          targets[gi * 3 + 2] = tmp.z;
          isHouse[gi] = 1;
        }
      } else if (densify > 0) {
        // No cabin found: leave the reserved block as ordinary dust.
        for (let gi = baseCount; gi < count; gi++) {
          const s = (gi - 1) * 3;
          targets[gi * 3] = targets[s];
          targets[gi * 3 + 1] = targets[s + 1];
          targets[gi * 3 + 2] = targets[s + 2];
          isHouse[gi] = 0;
        }
      }

      // Hero dust: a wide, bottom-heavy curtain receding into depth.
      for (let i = 0; i < count; i++) {
        const zt = Math.pow(Math.random(), 2.3);
        const xspread = 80 + zt * 240;
        const yb = Math.pow(Math.random(), 3.4);
        const floor = -54 - zt * 10;
        positions[i * 3 + 0] = (Math.random() - 0.5) * xspread;
        positions[i * 3 + 1] = floor + yb * (78 + zt * 30);
        positions[i * 3 + 2] = 14 - zt * 242;

        // Power-law sizes: max == previous top size, most grains far finer.
        scales[i] = Math.max(MIN_SCALE, MAX_SCALE * Math.pow(Math.random(), SIZE_EXP));
        brights[i] = 0.18 + Math.pow(Math.random(), 2.4) * 1.15;
        phases[i] = Math.random() * Math.PI * 2.0;
        heroVis[i] = Math.random();

        const p = pickColor();
        const jt = 0.05;
        colors[i * 3 + 0] = Math.min(1, p[0] + (Math.random() - 0.5) * jt);
        colors[i * 3 + 1] = Math.min(1, p[1] + (Math.random() - 0.5) * jt);
        colors[i * 3 + 2] = Math.min(1, p[2] + (Math.random() - 0.5) * jt);
      }

      // Debug probe: when set, glow ONLY the chosen material (overrides above).
      if (PROBE_MATERIAL) {
        isHouse.fill(0);
        for (let j = 0; j < probeIdx.length; j++) isHouse[probeIdx[j]] = 1;
      }

      // Colour: cool monochrome dust everywhere; ONLY loghouse grains get a warm
      // amber glow + a touch larger/brighter so the home reads clearly.
      const HOUSE_AMBER = [0.96, 0.56, 0.22];
      for (let i = 0; i < count; i++) {
        if (isHouse[i]) {
          const v = (Math.random() - 0.5) * 0.08;
          targetColors[i * 3] = clamp01(HOUSE_AMBER[0] + v);
          targetColors[i * 3 + 1] = clamp01(HOUSE_AMBER[1] + v);
          targetColors[i * 3 + 2] = clamp01(HOUSE_AMBER[2] + v * 0.5);
          brights[i] = 1.7 + Math.random() * 0.7;
          scales[i] = 1.0 + Math.random() * 0.7;
        } else {
          targetColors[i * 3] = colors[i * 3];
          targetColors[i * 3 + 1] = colors[i * 3 + 1];
          targetColors[i * 3 + 2] = colors[i * 3 + 2];
        }
      }

      // Morph delay by target height so the mountain rises base -> peaks.
      let tMinY = Infinity;
      let tMaxY = -Infinity;
      for (let i = 0; i < count; i++) {
        const ty = targets[i * 3 + 1];
        if (ty < tMinY) tMinY = ty;
        if (ty > tMaxY) tMaxY = ty;
      }
      const span = Math.max(1e-3, tMaxY - tMinY);
      for (let i = 0; i < count; i++) {
        const h = (targets[i * 3 + 1] - tMinY) / span;
        delays[i] = Math.min(1, Math.max(0, h * 0.85 + Math.random() * 0.15));
      }

      return { positions, scales, brights, phases, delays, heroVis, isHouse, colors, targetColors, targets };
    }, [count, scene]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSize: { value: 1.7 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
      uNearFade: { value: NEAR_FADE },
      uFarFade: { value: FAR_FADE },
      uBrightFloor: { value: BRIGHT_FLOOR },
      uDensity: { value: HAZE_DENSITY },
      uDissolveW: { value: DISSOLVE_W },
      uProgress: { value: 0 },
      uFade: { value: 1 },
      uRayOrigin: { value: new THREE.Vector3() },
      uRayDir: { value: new THREE.Vector3(0, 0, -1) },
      uMouseActive: { value: 0 },
      uMouseSpeed: { value: 0 },
      uRadius: { value: RAY_RADIUS },
      uStrength: { value: RAY_STRENGTH },
      uWarp: { value: 0 },
      uPortal: { value: new THREE.Vector3(portal[0], portal[1], portal[2]) },
      uHouseOnly: { value: DEBUG_HOUSE_ONLY ? 1 : 0 },
    }),
    []
  );

  useFrame((state) => {
    if (matRef.current) {
      const u = matRef.current.uniforms;
      u.uTime.value = state.clock.elapsedTime;
      const s = sRef ? sRef.current : 0;
      u.uProgress.value = smoothstep(0.06, 0.5, s);

      // Build the cursor ray in WORLD space from the camera through the pointer.
      const px = state.pointer.x;
      const py = state.pointer.y;
      const speed = Math.hypot(px - lastP.current.x, py - lastP.current.y);
      lastP.current.x = px;
      lastP.current.y = py;

      raycaster.current.setFromCamera(state.pointer, state.camera);
      u.uRayOrigin.value.copy(raycaster.current.ray.origin);
      u.uRayDir.value.copy(raycaster.current.ray.direction);
      const targetSpeed = pointerReady.current ? Math.min(speed, 0.1) : 0;
      u.uMouseSpeed.value += (targetSpeed - u.uMouseSpeed.value) * (targetSpeed > u.uMouseSpeed.value ? 0.2 : 0.5);

      // Active only after a real unlocked mouse move; off during roam.
      const targetActive = roam || !pointerReady.current ? 0 : 1;
      const ease = targetActive > u.uMouseActive.value ? 0.14 : 0.6; // drop OFF quickly
      u.uMouseActive.value += (targetActive - u.uMouseActive.value) * ease;

      u.uWarp.value = warpRef ? warpRef.current : 0;
      // Collapse toward whichever portal this warp is diving into (WORK/ABOUT).
      if (portal) u.uPortal.value.set(portal[0], portal[1], portal[2]);
    }
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-aScale" count={count} array={scales} itemSize={1} />
        <bufferAttribute attach="attributes-aBright" count={count} array={brights} itemSize={1} />
        <bufferAttribute attach="attributes-aPhase" count={count} array={phases} itemSize={1} />
        <bufferAttribute attach="attributes-aDelay" count={count} array={delays} itemSize={1} />
        <bufferAttribute attach="attributes-aHeroVis" count={count} array={heroVis} itemSize={1} />
        <bufferAttribute attach="attributes-aIsHouse" count={count} array={isHouse} itemSize={1} />
        <bufferAttribute attach="attributes-aColor" count={count} array={colors} itemSize={3} />
        <bufferAttribute attach="attributes-aTargetColor" count={count} array={targetColors} itemSize={3} />
        <bufferAttribute attach="attributes-aTarget" count={count} array={targets} itemSize={3} />
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={grainFragment}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

useGLTF.preload("/models/mountain.glb");
