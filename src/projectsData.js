// Case studies shown in the WORK section gallery. `cat` matches the pill labels.
// `url` is the LIVE Vercel deployment — used both for the in-card iframe preview
// and the click-through. `img` is a static poster shown while the iframe loads
// (and for off-screen cards, to keep the gallery light).
export const PROJECTS = [
  { n: "01", title: "The Connected Ecosystem", cat: "Digital Product", img: "/projects/01.png", url: "https://project-44fib.vercel.app" },
  { n: "02", title: "WorkCenter 2.0", cat: "Digital Product", img: "/projects/02.png", url: "https://wc-2-beta.vercel.app" },
  { n: "03", title: "AI Idea Hub", cat: "Digital Product", img: "/projects/03.png", url: "https://ai-idea-hub-delta.vercel.app" },
  { n: "04", title: "Atelier", cat: "Digital Product", img: "/projects/04.png", url: "https://atelier-room-designer.vercel.app" },
  { n: "05", title: "Civic Simbaa", cat: "Digital Product", img: "/projects/05.png", url: "https://civic-simba.vercel.app" },
  { n: "06", title: "SBI 2040", cat: "Digital Product", img: "/projects/06.png", url: "https://sbi-2040.vercel.app" },
  { n: "07", title: "Dispenser Ops Console", cat: "Digital Product", img: "/projects/07.png", url: "https://salesforce-erp.vercel.app" },
  { n: "08", title: "SmartScope", cat: "New Product Development", img: "/projects/08.png", url: "https://smartscope-navy.vercel.app" },
  { n: "09", title: "LaundroTot", cat: "New Product Development", img: "/projects/09.png", url: "https://laundrotot.vercel.app" },
  { n: "10", title: "Enigma Explorer", cat: "New Product Development", img: "/projects/10.png", url: "https://enigma-three-neon.vercel.app" },
  { n: "11", title: "VANA", cat: "Physical Product", img: "/projects/11.png", url: "https://m-des-final-project.vercel.app" },
  { n: "12", title: "Ergo", cat: "Physical Product", img: "/projects/12.png", url: "https://self-eye-drop-dispenser.vercel.app" },
  { n: "13", title: "Quantitative Market Study", cat: "Quantitative Market Study", img: "/projects/13.png", url: "https://quantitative-market-study.vercel.app" },
  { n: "14", title: "KR Flower Market", cat: "Research", img: "/projects/14.png", url: "https://kr-flower-market.vercel.app" },
  { n: "15", title: "Farmly", cat: "Research", img: "/projects/15.png", url: "https://farmly-kappa.vercel.app" },
  { n: "16", title: "Selected Experiments", cat: "Miscellaneous", img: "/projects/16.png", url: "https://site-lemon-omega-52.vercel.app" },
];

// "Selected Work" = a curated 5 (in this exact order).
export const SELECTED = ["01", "02", "04", "03", "11"];

// Single source of truth for which projects a pill shows (used by the rail,
// the counter and the prev/next nav so they always agree).
export function projectsForCategory(cat) {
  if (!cat || cat === "Selected Work") {
    return SELECTED.map((n) => PROJECTS.find((p) => p.n === n)).filter(Boolean);
  }
  return PROJECTS.filter((p) => p.cat === cat);
}
