const projects = [
  { n: "01", title: "Lumen", cat: "WebGL · Brand", year: "2025" },
  { n: "02", title: "Garden OS", cat: "SaaS · Product", year: "2024" },
  { n: "03", title: "Echo", cat: "Interactive · 3D", year: "2024" },
  { n: "04", title: "Folio Type", cat: "Tool · Open Source", year: "2023" },
];

const skills = [
  { group: "Craft", items: ["Creative Development", "WebGL / Three.js", "Shaders (GLSL)", "Interaction Design"] },
  { group: "Motion", items: ["GSAP", "Scroll Choreography", "Framer Motion", "Prototyping"] },
  { group: "Build", items: ["React", "TypeScript", "Vite", "Performance"] },
];

function Section({ id, children, className = "" }) {
  return (
    <section id={id} className={`relative px-6 py-28 sm:px-10 sm:py-36 ${className}`}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

function Label({ children }) {
  return <span className="label text-dim">{children}</span>;
}

export default function Content() {
  return (
    <div className="relative z-10 bg-void">
      {/* Smooth fade from the transparent hero scene into solid content */}
      <div className="pointer-events-none h-40 w-full bg-gradient-to-b from-transparent to-void" />

      {/* ABOUT */}
      <Section id="about">
        <Label>About</Label>
        <h2 className="mt-8 max-w-4xl font-serif text-4xl leading-[1.1] tracking-tight sm:text-6xl">
          I craft immersive digital experiences where{" "}
          <span className="italic">design meets engineering</span> — interfaces
          that feel alive.
        </h2>
        <div className="mt-12 grid gap-10 sm:grid-cols-2">
          <p className="text-base leading-relaxed text-dim sm:text-lg">
            I'm a creative developer focused on the space between motion, 3D and
            the web. I build sites that don't just inform — they leave an
            impression.
          </p>
          <p className="text-base leading-relaxed text-dim sm:text-lg">
            From real-time WebGL and custom shaders to scroll-driven storytelling,
            I obsess over the details that make a product feel considered.
          </p>
        </div>
      </Section>

      {/* WORK */}
      <Section id="work" className="border-t border-white/5">
        <Label>Selected Work</Label>
        <h2 className="mt-8 font-serif text-4xl tracking-tight sm:text-5xl">
          Things I've <span className="italic">built</span>
        </h2>
        <ul className="mt-14">
          {projects.map((p) => (
            <li key={p.n}>
              <a
                href="#"
                className="group flex items-center justify-between gap-6 border-t border-white/10 py-7 transition-colors hover:bg-white/[0.02]"
              >
                <span className="flex items-baseline gap-5">
                  <span className="label text-dim">{p.n}</span>
                  <span className="font-serif text-3xl tracking-tight transition-transform duration-300 group-hover:translate-x-2 sm:text-5xl">
                    {p.title}
                  </span>
                </span>
                <span className="hidden text-sm text-dim sm:block">{p.cat}</span>
                <span className="label text-dim">{p.year}</span>
              </a>
            </li>
          ))}
          <li className="border-t border-white/10" />
        </ul>
      </Section>

      {/* SKILLS */}
      <Section id="skills" className="border-t border-white/5">
        <Label>Capabilities</Label>
        <h2 className="mt-8 font-serif text-4xl tracking-tight sm:text-5xl">
          How I <span className="italic">help</span>
        </h2>
        <div className="mt-14 grid gap-10 sm:grid-cols-3">
          {skills.map((col) => (
            <div key={col.group}>
              <h3 className="font-serif text-2xl tracking-tight">{col.group}</h3>
              <ul className="mt-5 space-y-3">
                {col.items.map((it) => (
                  <li key={it} className="flex items-center gap-3 text-dim">
                    <span className="h-1 w-1 rounded-full bg-fog/60" />
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      {/* CONTACT */}
      <Section id="contact" className="border-t border-white/5">
        <Label>Contact</Label>
        <h2 className="mt-8 max-w-4xl font-serif text-5xl leading-[1.05] tracking-tight sm:text-8xl">
          Let's create something{" "}
          <span className="italic">unforgettable.</span>
        </h2>
        <a
          href="mailto:hello@example.com"
          className="mt-12 inline-flex items-center gap-3 font-serif text-2xl italic underline-offset-8 transition-all hover:underline sm:text-4xl"
        >
          hello@example.com
          <span aria-hidden>↗</span>
        </a>

        <div className="mt-24 flex flex-col gap-6 border-t border-white/10 pt-8 text-sm text-dim sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Your Name</span>
          <div className="flex gap-6">
            <a href="#" className="transition-colors hover:text-fog">LinkedIn</a>
            <a href="#" className="transition-colors hover:text-fog">Twitter</a>
            <a href="#" className="transition-colors hover:text-fog">Instagram</a>
          </div>
        </div>
      </Section>
    </div>
  );
}
