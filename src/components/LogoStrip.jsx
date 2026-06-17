// Infinite, looping marquee of the tools/software from the resume. Logos are
// pulled as white monochrome SVGs from the Simple Icons CDN so the strip stays
// crisp on the dark scene. The list is duplicated once so the CSS translateX
// (-50%) loop is perfectly seamless.
// Simple Icons (brand colour) for most tools; Adobe apps dropped those marks
// from that CDN, so Ps/Ai/Xd are hosted locally (two-tone app icons).
const si = (slug) => `https://cdn.simpleicons.org/${slug}`;
// Deliberately mixed order so similar tools (Adobe apps, the PM/analytics set,
// the AI set) are spread out across the strip rather than clustered together.
const LOGOS = [
  { src: si("figma"), n: "Figma" },
  { src: si("n8n"), n: "n8n" },
  { src: si("jira"), n: "Jira" },
  { src: "/logos/photoshop.svg", n: "Photoshop" },
  { src: si("blender"), n: "Blender" },
  { src: si("claude"), n: "Claude" },
  { src: si("mixpanel"), n: "Mixpanel" },
  { src: si("framer"), n: "Framer" },
  { src: si("cursor"), n: "Cursor" },
  { src: "/logos/illustrator.svg", n: "Illustrator" },
  { src: si("confluence"), n: "Confluence" },
  { src: si("googlegemini"), n: "Gemini" },
  { src: si("autodesk"), n: "Fusion 360" },
  { src: si("googleanalytics"), n: "Analytics" },
  { src: si("sketch"), n: "Sketch" },
  { src: si("notion"), n: "Notion" },
  { src: "/logos/xd.svg", n: "Adobe XD" },
  { src: si("python"), n: "Python" },
  { src: si("miro"), n: "Miro" },
];

export default function LogoStrip() {
  const items = [...LOGOS, ...LOGOS];
  return (
    <div className="logo-marquee pointer-events-none fixed bottom-[clamp(0.75rem,3vh,3rem)] left-0 right-0 z-30">
      <div className="logo-marquee__track">
        {items.map((l, i) => (
          <span
            key={`${l.n}-${i}`}
            className="inline-flex shrink-0 items-center gap-2.5 rounded-full border border-white/55 bg-white/90 px-4 py-2 shadow-[0_6px_20px_rgba(0,0,0,0.4)] backdrop-blur-md"
          >
            <img
              src={l.src}
              alt={l.n}
              loading="lazy"
              className="h-[18px] w-[18px]"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <span className="font-body text-xs font-semibold tracking-wide text-zinc-800 whitespace-nowrap">
              {l.n}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
