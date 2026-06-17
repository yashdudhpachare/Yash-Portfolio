import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { MOUNT_CENTER, MOUNT_SIZE } from "./MountainCloud.jsx";
import { smoothstep } from "./grainShader.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Invisible solid model used purely as a raycast collider for walking.
export function Collider({ colliderRef }) {
  const { scene } = useGLTF("/models/mountain.glb");

  const obj = useMemo(() => {
    const clone = scene.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = MOUNT_SIZE / Math.max(size.x, size.y, size.z);
    clone.position.sub(center).multiplyScalar(scale).add(MOUNT_CENTER);
    clone.scale.setScalar(scale);
    clone.traverse((o) => {
      if (o.isMesh && o.material) o.material.side = THREE.DoubleSide;
    });
    clone.updateMatrixWorld(true);
    return clone;
  }, [scene]);

  useEffect(() => {
    colliderRef.current = obj;
    return () => {
      if (colliderRef.current === obj) colliderRef.current = null;
    };
  }, [obj, colliderRef]);

  return <primitive object={obj} visible={false} />;
}

// First-person WASD walk controller that walks on a baked terrain heightfield.
export function FreeRoam({
  enabled,
  colliderRef,
  eyeHeight = 4,
  speed = 16,
  landing = new THREE.Vector3(12, 0, 18),
  landingLookAt = null, // world point to face on arrival (else look at valley center)
  entryFrom = null,     // start the swoop from here (else from the current camera)
  entryDur = 1.7,       // seconds for the swoop
  poseRef = null,       // out: live {x,y,z,yaw} so callers can return you to this spot
}) {
  const { camera, gl } = useThree();
  const keys = useRef({});
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const yaw = useRef(0);
  const pitch = useRef(0);
  const locked = useRef(false);
  const ray = useRef(new THREE.Raycaster());
  const down = useMemo(() => new THREE.Vector3(0, -1, 0), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const inited = useRef(false);
  const entering = useRef(false);
  const entry = useRef(null);
  const hf = useRef(null);

  useEffect(() => {
    const dom = gl.domElement;
    // While walking, the arrow keys (and Space/PageUp/Down) must NOT scroll the
    // page — otherwise the home cinematic gets dragged back to the hero mid-walk.
    // We consume them here and use the arrows for movement (mirroring WASD).
    const NAV_KEYS = new Set([
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Space",
      "PageUp",
      "PageDown",
    ]);
    const onKeyDown = (e) => {
      keys.current[e.code] = true;
      if (enabledRef.current && NAV_KEYS.has(e.code)) e.preventDefault();
    };
    const onKeyUp = (e) => {
      keys.current[e.code] = false;
      if (enabledRef.current && NAV_KEYS.has(e.code)) e.preventDefault();
    };
    const onMouseMove = (e) => {
      if (!locked.current) return;
      const sens = 0.0022;
      yaw.current -= e.movementX * sens;
      pitch.current -= e.movementY * sens;
      const lim = Math.PI / 2 - 0.05;
      pitch.current = clamp(pitch.current, -lim, lim);
    };
    const onLockChange = () => {
      locked.current = document.pointerLockElement === dom;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", onLockChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onLockChange);
    };
  }, [gl]);

  useEffect(() => {
    if (enabled) inited.current = false;
    else keys.current = {};
  }, [enabled]);

  const probeRay = (x, z) => {
    const c = colliderRef.current;
    if (!c) return null;
    ray.current.set(new THREE.Vector3(x, 200, z), down);
    const hits = ray.current.intersectObject(c, true);
    return hits.length ? hits[0].point.y : null;
  };

  // Bake a continuous ground heightfield once: raycast a grid, then fill the
  // many holes in this fragmented model by averaging valid neighbours.
  const buildHeightField = (c) => {
    const box = new THREE.Box3().setFromObject(c);
    const minX = box.min.x;
    const minZ = box.min.z;
    const cell = 1.5;
    const nx = Math.ceil((box.max.x - minX) / cell) + 1;
    const nz = Math.ceil((box.max.z - minZ) / cell) + 1;
    const data = new Float32Array(nx * nz).fill(NaN);
    const valid = new Uint8Array(nx * nz);

    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const y = probeRay(minX + i * cell, minZ + j * cell);
        if (y !== null) {
          data[j * nx + i] = y;
          valid[j * nx + i] = 1;
        }
      }
    }

    const nb = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (let pass = 0; pass < 60; pass++) {
      let changed = false;
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const idx = j * nx + i;
          if (valid[idx]) continue;
          let sum = 0;
          let cnt = 0;
          for (const [di, dj] of nb) {
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
            if (valid[nj * nx + ni]) {
              sum += data[nj * nx + ni];
              cnt++;
            }
          }
          if (cnt > 0) {
            data[idx] = sum / cnt;
            changed = true;
          }
        }
      }
      for (let k = 0; k < data.length; k++) {
        if (!valid[k] && !Number.isNaN(data[k])) valid[k] = 1;
      }
      if (!changed) break;
    }
    for (let k = 0; k < data.length; k++) if (Number.isNaN(data[k])) data[k] = 0;

    return { minX, minZ, cell, nx, nz, data };
  };

  const groundHeight = (x, z) => {
    const h = hf.current;
    if (!h) return null;
    const fx = clamp((x - h.minX) / h.cell, 0, h.nx - 1);
    const fz = clamp((z - h.minZ) / h.cell, 0, h.nz - 1);
    const ix = Math.min(Math.floor(fx), h.nx - 2);
    const iz = Math.min(Math.floor(fz), h.nz - 2);
    const tx = fx - ix;
    const tz = fz - iz;
    const g = (i, j) => h.data[j * h.nx + i];
    const a = g(ix, iz);
    const b = g(ix + 1, iz);
    const c = g(ix, iz + 1);
    const d = g(ix + 1, iz + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };

  useFrame((_, delta) => {
    if (!enabled) return;
    if (!hf.current && colliderRef.current) {
      hf.current = buildHeightField(colliderRef.current);
    }
    const h = hf.current;
    if (!h) return;

    const margin = h.cell * 1.5;
    const dt = Math.min(delta, 0.05);

    // Set up the swoop-in: from the current (bird's-eye) pose down to the
    // first-person standpoint, giving the feeling of dropping into the world.
    if (!inited.current) {
      inited.current = true;
      const lx = clamp(landing.x, h.minX + margin, h.minX + (h.nx - 1) * h.cell - margin);
      const lz = clamp(landing.z, h.minZ + margin, h.minZ + (h.nz - 1) * h.cell - margin);
      const endPos = new THREE.Vector3(lx, groundHeight(lx, lz) + eyeHeight, lz);
      // Face the given world point (e.g. the WORK portal) or default to center.
      const lookT = landingLookAt
        ? landingLookAt.clone()
        : new THREE.Vector3(0, endPos.y - 2.0, 0);
      const m = new THREE.Matrix4().lookAt(endPos, lookT, up);
      const endQuat = new THREE.Quaternion().setFromRotationMatrix(m);
      // Either swoop from a local "step out" point (keeps the return short and
      // facing the portal) or from wherever the camera currently is.
      const startPos = entryFrom ? entryFrom.clone() : camera.position.clone();
      let startQuat;
      if (entryFrom) {
        const ms = new THREE.Matrix4().lookAt(startPos, lookT, up);
        startQuat = new THREE.Quaternion().setFromRotationMatrix(ms);
      } else {
        startQuat = camera.quaternion.clone();
      }
      entry.current = { t: 0, startPos, startQuat, endPos, endQuat };
      entering.current = true;
    }

    if (entering.current) {
      const en = entry.current;
      en.t += dt / entryDur;
      const e = smoothstep(0, 1, Math.min(1, en.t));
      camera.position.lerpVectors(en.startPos, en.endPos, e);
      camera.quaternion.copy(en.startQuat).slerp(en.endQuat, e);
      if (en.t >= 1) {
        entering.current = false;
        const eu = new THREE.Euler().setFromQuaternion(en.endQuat, "YXZ");
        yaw.current = eu.y;
        pitch.current = eu.x;
      }
      return; // hold WASD until we've landed
    }

    const k = keys.current;

    if (locked.current) {
      const sinY = Math.sin(yaw.current);
      const cosY = Math.cos(yaw.current);
      const fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
      const strafe = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);

      if (fwd || strafe) {
        let dx = -sinY * fwd + cosY * strafe;
        let dz = -cosY * fwd - sinY * strafe;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        const step = speed * dt;

        const maxX = h.minX + (h.nx - 1) * h.cell - margin;
        const maxZ = h.minZ + (h.nz - 1) * h.cell - margin;
        const nx = clamp(camera.position.x + dx * step, h.minX + margin, maxX);
        const nz = clamp(camera.position.z + dz * step, h.minZ + margin, maxZ);

        const curG = camera.position.y - eyeHeight;
        const ng = groundHeight(nx, nz);
        // Block climbing near-vertical walls; allow slopes and descents.
        if (ng - curG < step * 1.4 + 0.5) {
          camera.position.x = nx;
          camera.position.z = nz;
          camera.position.y = ng + eyeHeight;
        }
      } else {
        const gy = groundHeight(camera.position.x, camera.position.z);
        camera.position.y += (gy + eyeHeight - camera.position.y) * 0.35;
      }
    }

    const euler = new THREE.Euler(pitch.current, yaw.current, 0, "YXZ");
    camera.quaternion.setFromEuler(euler);

    // Publish the live walk pose so the app can return you to this exact spot.
    if (poseRef) {
      poseRef.current = {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        yaw: yaw.current,
      };
    }
  });

  return null;
}

useGLTF.preload("/models/mountain.glb");
