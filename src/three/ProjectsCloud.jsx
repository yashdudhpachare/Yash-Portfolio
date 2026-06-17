import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as THREE from "three";
import { grainFragment, pickColor, smoothstep } from "./grainShader.js";

// Dust-traced mountain. Particles are placed centered at the origin and
// uniform-scaled to fit FIT_SIZE so the orbiting projects camera frames it.
// Grain character (size/density/movement/fade) is matched to the home
// MountainCloud so both sections read identically.
const FIT_SIZE = 120;     // == home MOUNT_SIZE for matching grain density
const DUST_SPREAD = 220;  // size of the cloud the mountain condenses out of

// Grain sizing — identical to home MountainCloud.
const MAX_SCALE = 1.85;
const MIN_SCALE = 0.3;
const SIZE_EXP = 2.5;

// Atmospheric depth band. Home uses NEAR 40 / FAR 200 at a ~25-unit view; the
// projects camera orbits ~3-4x farther, so these distance-based values are
// scaled up to reproduce the SAME visual near->far gradient.
const NEAR_FADE = 70;
const FAR_FADE = 330;
const BRIGHT_FLOOR = 0.32;   // == home
const HAZE_DENSITY = 0.0012; // == home 0.0035 rescaled for the farther orbit
const DISSOLVE_W = 0.16;     // == home

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uProgress;   // 0 dust -> 1 formed
  uniform float uNearFade;
  uniform float uFarFade;
  uniform float uBrightFloor;
  uniform float uDensity;
  uniform float uDissolveW;

  attribute float aScale;
  attribute float aBright;
  attribute float aPhase;
  attribute float aDelay;
  attribute vec3 aColor;
  attribute vec3 aTarget;

  varying float vBright;
  varying float vAlpha;
  varying float vTwinkle;
  varying vec3 vColor;

  void main() {
    // Per-grain staggered morph (matches home: window 0.7) so the mountain
    // assembles from its base upward.
    float window = 0.7;
    float d = aDelay * window;
    float lp = clamp((uProgress - d) / max(1.0 - window, 0.001), 0.0, 1.0);
    float ease = smoothstep(0.0, 1.0, lp);
    vec3 morphed = mix(position, aTarget, ease);

    // How "in transit" a grain is (0 at ends, 1 mid-morph) — same as home.
    float transit = ease * (1.0 - ease) * 4.0;

    // Gentle drift — IDENTICAL frequencies/amplitude to home MountainCloud.
    float ph = aPhase;
    float amp = (0.09 + aScale * 0.05) * (1.0 - ease * 0.6);
    morphed.x += sin(uTime * 2.4 + ph) * amp;
    morphed.y += cos(uTime * 2.1 + ph * 1.3) * amp;
    morphed.z += sin(uTime * 1.8 + ph * 0.7) * amp * 0.6;

    vec4 mvPosition = modelViewMatrix * vec4(morphed, 1.0);
    float dist = -mvPosition.z;

    vTwinkle = 0.65 + 0.35 * sin(uTime * 1.1 + aPhase);

    // Atmospheric depth — same recipe as home (near->far band + haze).
    float depth = smoothstep(uFarFade, uNearFade, dist);
    depth *= exp(-dist * uDensity);
    float nearFade = smoothstep(0.6, 4.5, dist);

    // Per-grain noise dissolve — same as home.
    float seed = fract(aPhase * 0.1591549431);
    float dissolve = smoothstep(seed - uDissolveW, seed + uDissolveW, depth);

    vAlpha  = dissolve * nearFade * (1.0 - 0.5 * transit);
    vBright = aBright * (1.0 + ease * 0.25) * (1.0 - 0.4 * transit);
    vBright *= mix(uBrightFloor, 1.0, depth);
    vColor = aColor;

    // Size formula matches home (numerator scaled for the farther orbit so the
    // grains read at the same on-screen size); same depth shrink + clamp.
    gl_PointSize = uSize * aScale * uPixelRatio * (300.0 / dist);
    gl_PointSize *= mix(0.45, 1.0, depth);
    gl_PointSize = clamp(gl_PointSize, 0.0, 3.6);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

function buildMergedGeometry(scene) {
  const geos = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      const ng = new THREE.BufferGeometry();
      ng.setAttribute("position", g.getAttribute("position").clone());
      geos.push(ng);
    }
  });
  if (!geos.length) return null;
  return geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
}

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

export default function ProjectsCloud({ count = 200000, progressRef, rotation = [0, 0, 0] }) {
  const matRef = useRef();
  const { scene } = useGLTF("/models/great_mountain.glb");

  const { positions, scales, brights, phases, delays, colors, targets } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const brights = new Float32Array(count);
    const phases = new Float32Array(count);
    const delays = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const targets = new Float32Array(count * 3);

    // Same centering + uniform scale the solid model used.
    const merged = buildMergedGeometry(scene);
    const center = new THREE.Vector3();
    let scale = 1;
    if (merged) {
      merged.computeBoundingBox();
      const bb = merged.boundingBox;
      bb.getCenter(center);
      const size = new THREE.Vector3();
      bb.getSize(size);
      scale = FIT_SIZE / Math.max(size.x, size.y, size.z);
    }

    scene.updateMatrixWorld(true);
    const meshes = [];
    scene.traverse((o) => {
      if (o.isMesh && o.geometry) meshes.push(o);
    });
    const areas = meshes.map(meshWorldArea);
    const totalArea = areas.reduce((a, b) => a + b, 0) || 1;

    const tmp = new THREE.Vector3();
    let written = 0;
    for (let mi = 0; mi < meshes.length; mi++) {
      const m = meshes[mi];
      let n =
        mi === meshes.length - 1
          ? count - written
          : Math.round((count * areas[mi]) / totalArea);
      if (n <= 0) continue;
      if (written + n > count) n = count - written;

      const sampler = new MeshSurfaceSampler(m).build();
      for (let k = 0; k < n; k++) {
        const gi = written + k;
        sampler.sample(tmp);
        tmp.applyMatrix4(m.matrixWorld);   // local -> world (GLB has a root matrix)
        tmp.sub(center).multiplyScalar(scale); // center at origin + fit scale
        targets[gi * 3 + 0] = tmp.x;
        targets[gi * 3 + 1] = tmp.y;
        targets[gi * 3 + 2] = tmp.z;
      }
      written += n;
    }
    for (let gi = written; gi < count; gi++) {
      const s = (gi - 1) * 3;
      targets[gi * 3 + 0] = targets[s];
      targets[gi * 3 + 1] = targets[s + 1];
      targets[gi * 3 + 2] = targets[s + 2];
    }

    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * DUST_SPREAD;
      positions[i * 3 + 1] = (Math.random() - 0.5) * DUST_SPREAD * 0.6;
      positions[i * 3 + 2] = (Math.random() - 0.5) * DUST_SPREAD;

      scales[i] = Math.max(MIN_SCALE, MAX_SCALE * Math.pow(Math.random(), SIZE_EXP));
      brights[i] = 0.18 + Math.pow(Math.random(), 2.4) * 1.15; // == home
      phases[i] = Math.random() * Math.PI * 2.0;

      const p = pickColor();
      const jt = 0.05;
      colors[i * 3 + 0] = Math.min(1, p[0] + (Math.random() - 0.5) * jt);
      colors[i * 3 + 1] = Math.min(1, p[1] + (Math.random() - 0.5) * jt);
      colors[i * 3 + 2] = Math.min(1, p[2] + (Math.random() - 0.5) * jt);
    }

    // Stagger morph by target height so peaks rise last.
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
      delays[i] = Math.min(1, Math.max(0, h * 0.8 + Math.random() * 0.2));
    }

    return { positions, scales, brights, phases, delays, colors, targets };
  }, [count, scene]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSize: { value: 1.7 }, // == home
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
      uProgress: { value: 0 },
      uNearFade: { value: NEAR_FADE },
      uFarFade: { value: FAR_FADE },
      uBrightFloor: { value: BRIGHT_FLOOR },
      uDensity: { value: HAZE_DENSITY },
      uDissolveW: { value: DISSOLVE_W },
      uFade: { value: 1 }, // REQUIRED by grainFragment; without it alpha=0 -> invisible
    }),
    []
  );

  useFrame((state) => {
    if (matRef.current) {
      const u = matRef.current.uniforms;
      u.uTime.value = state.clock.elapsedTime;
      // Driven by the reveal ref so the mountain assembles from dust right as
      // we emerge from the portal absorb.
      u.uProgress.value = progressRef ? progressRef.current : 1;
      // Stay invisible during the warp dive (reveal pinned at 0) and fade in the
      // instant the formation begins — so the dust->mountain morph IS the
      // visible transition, with no premature dust cluttering the dive.
      u.uFade.value = smoothstep(0.0, 0.02, u.uProgress.value);
    }
  });

  return (
    <points rotation={rotation}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-aScale" count={count} array={scales} itemSize={1} />
        <bufferAttribute attach="attributes-aBright" count={count} array={brights} itemSize={1} />
        <bufferAttribute attach="attributes-aPhase" count={count} array={phases} itemSize={1} />
        <bufferAttribute attach="attributes-aDelay" count={count} array={delays} itemSize={1} />
        <bufferAttribute attach="attributes-aColor" count={count} array={colors} itemSize={3} />
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

useGLTF.preload("/models/great_mountain.glb");
