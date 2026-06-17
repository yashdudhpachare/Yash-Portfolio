import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import { grainFragment, pickColor } from "./grainShader.js";

// === Event horizon ========================================================
// Soft dark disc — the void. Uses NormalBlending so it actually darkens what
// it covers, no bright rim, no shimmer.
const horizonFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uAppear;
  void main(){
    vec2 c = vUv - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    // Solid black core, softly fading into transparency at the rim.
    float core = smoothstep(0.46, 0.22, r);
    float a = core * uAppear;
    gl_FragColor = vec4(vec3(0.0), a);
  }
`;
const basicVert = /* glsl */ `
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// === Infalling dust grains (with comet trails) ===========================
// Each "logical particle" is replicated TRAIL_STEPS times. Echo points sample
// the same trajectory at a slightly earlier lifecycle position, so they trail
// behind the head along the actual spiral path — like a comet's tail. Trail
// points are smaller and dimmer, the head is full-size.
const dustVert = /* glsl */ `
  uniform float uTime;
  uniform float uAppear;
  uniform float uPixelRatio;
  uniform float uTrailLen;
  attribute float aR0;
  attribute float aA0;
  attribute float aH0;
  attribute float aLife;
  attribute float aSpd;
  attribute float aScale;
  attribute float aBright;
  attribute float aPhase;
  attribute float aEcho;     // 0 = head, 1 = oldest trail point
  attribute vec3 aColor;

  varying float vAlpha;
  varying float vBright;
  varying float vTwinkle;
  varying vec3 vColor;

  void main(){
    // Shift this echo backward in the lifecycle. Trail samples sit at earlier
    // (larger r, earlier angle) positions along the SAME spiral the head took.
    float t = fract(uTime * 0.05 + aLife - aEcho * uTrailLen);
    float k = 1.0 - t;                        // 1 outer .. 0 horizon
    float r = mix(0.34, aR0, k);
    // Same gentle orbit (constant angular speed) — backward in time for echoes.
    float ang = aA0 + (uTime - aEcho * uTrailLen / 0.05) * aSpd * 0.18;
    float h = aH0 * k;

    vec3 local = vec3(cos(ang) * r, sin(ang) * r, h);
    local.x += sin(uTime * 0.6 + aPhase) * 0.015;
    local.y += cos(uTime * 0.55 + aPhase * 1.3) * 0.015;

    vec4 mv = modelViewMatrix * vec4(local, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;

    vTwinkle = 0.65 + 0.35 * sin(uTime * 1.1 + aPhase);
    vColor = aColor;

    float trail = 1.0 - aEcho;                // 1 head .. 0 tail
    float headWeight = pow(trail, 1.6);       // quick falloff so tails are subtle

    vBright = aBright * uAppear * mix(0.35, 1.0, headWeight);
    float edgeIn  = smoothstep(0.0, 0.18, t);
    float edgeOut = 1.0 - smoothstep(0.82, 1.0, t);
    vAlpha = edgeIn * edgeOut * uAppear * mix(0.25, 1.0, headWeight);

    float pSize = aScale * uPixelRatio * (38.0 / max(dist, 0.5));
    pSize *= mix(0.35, 1.0, headWeight);      // tail points are smaller
    gl_PointSize = clamp(pSize, 0.0, 2.4);
  }
`;

const BASE_PARTICLES = 700;
const TRAIL_STEPS = 6;                        // head + 5 echoes
const PARTICLES = BASE_PARTICLES * TRAIL_STEPS;
const TRAIL_LEN = 0.06;                       // fraction of lifecycle the trail spans

// "ENTER" prompt curving around the OUTSIDE of the ring.
const PROMPT_TEXT = "ENTER";
const PROMPT_CHARS = PROMPT_TEXT.split("");
const PROMPT_ARC_DEG = 58;        // total arc the letters occupy (top of ring)
const PROMPT_RADIUS = 0.88;       // just outside the outer neon glow torus
const NEAR_DIST = 4.5;            // matches ENTER_DIST in Scene.jsx

export default function Portal({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  appearRef,
  onEnter,
  label = "",
  roam = false,                   // when true, show "ENTER" prompt if camera is near
}) {
  const group = useRef();
  const spin = useRef();
  const horizonMat = useRef();
  const dustMat = useRef();
  const ringMat = useRef();
  const ringGlowMat = useRef();
  const labelRef = useRef();
  const promptRefs = useRef([]);
  const promptOpacity = useRef(0);
  const portalWorldPos = useMemo(() => new THREE.Vector3(position[0], position[1], position[2]), [position[0], position[1], position[2]]);
  const [hover, setHover] = useState(false);

  const attribs = useMemo(() => {
    const aR0 = new Float32Array(PARTICLES);
    const aA0 = new Float32Array(PARTICLES);
    const aH0 = new Float32Array(PARTICLES);
    const aLife = new Float32Array(PARTICLES);
    const aSpd = new Float32Array(PARTICLES);
    const aScale = new Float32Array(PARTICLES);
    const aBright = new Float32Array(PARTICLES);
    const aPhase = new Float32Array(PARTICLES);
    const aEcho = new Float32Array(PARTICLES);
    const aColor = new Float32Array(PARTICLES * 3);
    const positions = new Float32Array(PARTICLES * 3);
    for (let b = 0; b < BASE_PARTICLES; b++) {
      // Spawn radius biased outward — the cloud feels like the surrounding
      // scene dust drifting toward the well rather than a tight halo on the disc.
      const u = Math.random();
      const r0 = 1.2 + Math.pow(u, 0.55) * 2.2;        // 1.2 .. ~3.4
      const a0 = Math.random() * Math.PI * 2;
      const h0 = (Math.random() - 0.5) * 0.6;
      const life = Math.random();
      const spd = 0.6 + Math.random() * 0.5;
      const scale = Math.max(0.3, 1.85 * Math.pow(Math.random(), 2.5));
      const bright = 0.18 + Math.pow(Math.random(), 2.4) * 1.15;
      const phase = Math.random() * Math.PI * 2;
      const p = pickColor();
      const jt = 0.05;
      const cr = Math.min(1, p[0] + (Math.random() - 0.5) * jt);
      const cg = Math.min(1, p[1] + (Math.random() - 0.5) * jt);
      const cb = Math.min(1, p[2] + (Math.random() - 0.5) * jt);
      for (let e = 0; e < TRAIL_STEPS; e++) {
        const i = b * TRAIL_STEPS + e;
        aR0[i] = r0;
        aA0[i] = a0;
        aH0[i] = h0;
        aLife[i] = life;
        aSpd[i] = spd;
        aScale[i] = scale;
        aBright[i] = bright;
        aPhase[i] = phase;
        aEcho[i] = e / (TRAIL_STEPS - 1);
        aColor[i * 3 + 0] = cr;
        aColor[i * 3 + 1] = cg;
        aColor[i * 3 + 2] = cb;
      }
    }
    return { aR0, aA0, aH0, aLife, aSpd, aScale, aBright, aPhase, aEcho, aColor, positions };
  }, []);

  const uHorizon = useMemo(() => ({ uAppear: { value: 0 } }), []);
  const uDust = useMemo(
    () => ({
      uTime: { value: 0 },
      uAppear: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
      uFade: { value: 1 },
      uTrailLen: { value: TRAIL_LEN },
    }),
    []
  );

  useFrame((state) => {
    const a = appearRef ? Math.min(1, Math.max(0, appearRef.current)) : 1;
    const t = state.clock.elapsedTime;
    if (horizonMat.current) horizonMat.current.uniforms.uAppear.value = a;
    if (dustMat.current) {
      dustMat.current.uniforms.uTime.value = t;
      dustMat.current.uniforms.uAppear.value = a;
    }
    if (ringMat.current) {
      const pulse = 0.78 + 0.22 * Math.sin(t * 2.0);
      ringMat.current.opacity = a * pulse * (hover ? 1.0 : 0.9);
    }
    if (ringGlowMat.current) {
      const pulse = 0.55 + 0.45 * Math.sin(t * 2.0 + 0.4);
      ringGlowMat.current.opacity = a * pulse * (hover ? 0.9 : 0.55);
    }
    if (labelRef.current) {
      labelRef.current.fillOpacity = a;
      labelRef.current.outlineOpacity = a * 0.9;
    }

    // Curved "ENTER" prompt: only when the player is near AND walking.
    const wantPrompt = roam && state.camera.position.distanceTo(portalWorldPos) <= NEAR_DIST ? 1 : 0;
    promptOpacity.current += (wantPrompt - promptOpacity.current) * 0.18;
    const op = promptOpacity.current * a;
    for (const tex of promptRefs.current) {
      if (tex) {
        tex.fillOpacity = op;
        tex.outlineOpacity = op * 0.9;
      }
    }
    if (group.current) group.current.visible = a > 0.01;
    if (spin.current) {
      const pop = (hover ? 1.06 : 1.0) * (0.55 + 0.45 * a);
      spin.current.scale.setScalar(pop);
    }
  });

  const active = () => (appearRef ? appearRef.current > 0.5 : true);

  return (
    <group ref={group} position={position} rotation={rotation} scale={0.5}>
      {/* Billboard label INSIDE the ring — sits just in front of the void disc
          and always faces the camera. Stays a stable size (outside the spin
          group so it doesn't pulse). */}
      {label ? (
        <Billboard position={[0, 0, 0.05]} follow={true}>
          <Text
            ref={labelRef}
            fontSize={0.22}
            color={"#9ee8ff"}
            anchorX="center"
            anchorY="middle"
            letterSpacing={0.15}
            outlineWidth={0.01}
            outlineColor={"#001a2a"}
            outlineOpacity={0.9}
            material-toneMapped={false}
            material-transparent={true}
            material-depthWrite={false}
            renderOrder={5}
          >
            {label.toUpperCase()}
          </Text>
        </Billboard>
      ) : null}

      {/* "ENTER" curving along the top of the ring — only fades in when the
          player is near AND in walk mode. Billboarded so the letters always face
          the camera and read correctly on every portal regardless of its yaw
          (otherwise portals turned away from you show the text mirrored). */}
      <Billboard follow position={[0, 0, 0.06]}>
        {PROMPT_CHARS.map((ch, i) => {
          const span = (PROMPT_ARC_DEG * Math.PI) / 180;
          const step = PROMPT_CHARS.length > 1 ? span / (PROMPT_CHARS.length - 1) : 0;
          const angle = -span / 2 + i * step;
          const x = Math.sin(angle) * PROMPT_RADIUS;
          const y = Math.cos(angle) * PROMPT_RADIUS;
          return (
            <Text
              key={i}
              ref={(el) => {
                promptRefs.current[i] = el;
              }}
              position={[x, y, 0]}
              rotation={[0, 0, -angle]}
              fontSize={0.13}
              color={"#3ad7ff"}
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.008}
              outlineColor={"#001a2a"}
              outlineOpacity={0}
              fillOpacity={0}
              letterSpacing={0.08}
              material-toneMapped={false}
              material-transparent={true}
              material-depthWrite={false}
              renderOrder={6}
            >
              {ch}
            </Text>
          );
        })}
      </Billboard>

      <group ref={spin}>
        {/* Event horizon — the void at the center */}
        <mesh renderOrder={1}>
          <circleGeometry args={[0.7, 64]} />
          <shaderMaterial
            ref={horizonMat}
            uniforms={uHorizon}
            vertexShader={basicVert}
            fragmentShader={horizonFrag}
            transparent
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Neon-blue outer halo — soft, wider torus that bloom turns into glow */}
        <mesh renderOrder={2}>
          <torusGeometry args={[0.66, 0.05, 14, 96]} />
          <meshBasicMaterial
            ref={ringGlowMat}
            color={"#00b8ff"}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            opacity={0.55}
          />
        </mesh>

        {/* Neon-blue beacon ring — the click target. Bright, crisp, pulsing.
            Tells the user "go here". */}
        <mesh
          renderOrder={3}
          onPointerOver={(e) => {
            if (!active()) return;
            e.stopPropagation();
            setHover(true);
          }}
          onPointerOut={() => setHover(false)}
          onClick={(e) => {
            if (!active()) return;
            e.stopPropagation();
            onEnter && onEnter();
          }}
        >
          <torusGeometry args={[0.62, 0.018, 16, 128]} />
          <meshBasicMaterial
            ref={ringMat}
            color={"#3ad7ff"}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            opacity={0.95}
            toneMapped={false}
          />
        </mesh>

        {/* Surrounding dust being drawn into the well */}
        <points renderOrder={4}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" count={PARTICLES} array={attribs.positions} itemSize={3} />
            <bufferAttribute attach="attributes-aR0" count={PARTICLES} array={attribs.aR0} itemSize={1} />
            <bufferAttribute attach="attributes-aA0" count={PARTICLES} array={attribs.aA0} itemSize={1} />
            <bufferAttribute attach="attributes-aH0" count={PARTICLES} array={attribs.aH0} itemSize={1} />
            <bufferAttribute attach="attributes-aLife" count={PARTICLES} array={attribs.aLife} itemSize={1} />
            <bufferAttribute attach="attributes-aSpd" count={PARTICLES} array={attribs.aSpd} itemSize={1} />
            <bufferAttribute attach="attributes-aScale" count={PARTICLES} array={attribs.aScale} itemSize={1} />
            <bufferAttribute attach="attributes-aBright" count={PARTICLES} array={attribs.aBright} itemSize={1} />
            <bufferAttribute attach="attributes-aPhase" count={PARTICLES} array={attribs.aPhase} itemSize={1} />
            <bufferAttribute attach="attributes-aEcho" count={PARTICLES} array={attribs.aEcho} itemSize={1} />
            <bufferAttribute attach="attributes-aColor" count={PARTICLES} array={attribs.aColor} itemSize={3} />
          </bufferGeometry>
          <shaderMaterial
            ref={dustMat}
            uniforms={uDust}
            vertexShader={dustVert}
            fragmentShader={grainFragment}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
      </group>
    </group>
  );
}
