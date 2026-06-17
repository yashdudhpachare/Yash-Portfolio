import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture, Text } from "@react-three/drei";
import * as THREE from "three";
import { PROJECTS } from "../projectsData.js";

// Layout (world units; mountain spans ~±60, camera sits on +x looking toward
// the peak so the screen's horizontal axis is world Z). Cards live behind the
// mountain in a horizontal row and slide sideways (along Z) as you scroll.
const CARD_W = 36;
const CARD_H = 25;            // hero aspect
const GAP = 12;
const STEP = CARD_W + GAP;    // horizontal spacing along Z
const X_BEHIND = -16;         // behind the mountain center (camera is on +x)
const CENTER_Y = 9;           // matches the camera look target

export default function ProjectsGallery({ progressRef, activeCat }) {
  const group = useRef();
  const tex = useTexture(PROJECTS.map((p) => p.img));
  useMemo(() => {
    (Array.isArray(tex) ? tex : [tex]).forEach((t) => {
      if (t) t.colorSpace = THREE.SRGBColorSpace;
    });
  }, [tex]);

  // Which cards to show (filtered by the active pill).
  const shown = useMemo(() => {
    const all = PROJECTS.map((p, i) => ({ p, i }));
    return activeCat && activeCat !== "Selected Work"
      ? all.filter((o) => o.p.cat === activeCat)
      : all;
  }, [activeCat]);

  const n = shown.length;

  useFrame(() => {
    if (!group.current) return;
    const prog = progressRef ? Math.min(1, Math.max(0, progressRef.current)) : 0;
    // Scroll slides the whole row sideways (along Z) so later cards travel
    // through the center — a horizontal gallery.
    group.current.position.z = prog * Math.max(0, n - 1) * STEP;
  });

  return (
    <group ref={group} position={[X_BEHIND, CENTER_Y, 0]}>
      {shown.map((o, k) => {
        const z = -k * STEP;
        return (
          <group key={o.p.n} position={[0, 0, z]} rotation={[0, Math.PI / 2, 0]}>
            {/* Solid frame + image drawn in the TRANSPARENT pass with a high
                renderOrder so they paint ON TOP of the additive dust (which is
                also transparent) — fully solid, never see-through. Clickable. */}
            <mesh position={[0, 0, -0.4]} renderOrder={998}>
              <planeGeometry args={[CARD_W + 1.4, CARD_H + 1.4]} />
              <meshBasicMaterial color="#070b12" toneMapped={false} transparent depthTest={false} depthWrite={false} />
            </mesh>
            <mesh
              renderOrder={999}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = "pointer";
              }}
              onPointerOut={() => {
                document.body.style.cursor = "";
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (o.p.href) window.open(encodeURI(o.p.href), "_blank", "noopener");
              }}
            >
              <planeGeometry args={[CARD_W, CARD_H]} />
              <meshBasicMaterial map={tex[o.i]} toneMapped={false} transparent depthTest={false} depthWrite={false} />
            </mesh>
            <Text
              position={[-CARD_W / 2, -CARD_H / 2 - 2.6, 0.1]}
              anchorX="left"
              anchorY="middle"
              fontSize={1.7}
              color="#eef4ff"
              outlineWidth={0.04}
              outlineColor="#000814"
              letterSpacing={0.04}
              renderOrder={1000}
              material-toneMapped={false}
              material-depthTest={false}
              material-transparent={true}
            >
              {`${o.p.n}  —  ${o.p.title.toUpperCase()}`}
            </Text>
          </group>
        );
      })}
    </group>
  );
}
