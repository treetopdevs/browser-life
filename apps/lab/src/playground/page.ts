type Entry = {
  title: string;
  href: string;
  status: string;
  description: string;
};

const entries: Entry[] = [
  { title: "Particles", href: "/particles/", status: "Live world", description: "A running particle environment with adjustable starting conditions." },
  { title: "Particle picker", href: "/particles/picker/", status: "Chooser", description: "Keep a favorite recipe and compare two nearby descendants." },
  { title: "Oases", href: "/particles/oases/", status: "Live world", description: "Compare still food patches with moving oases." },
  { title: "Seasons", href: "/particles/seasons/", status: "Live world", description: "A particle world with changing seasonal conditions." },
  { title: "Bonds", href: "/particles/bonds/", status: "Live world", description: "Explore a particle world with bond formation and breakage." },
  { title: "Motifs", href: "/particles/motifs/", status: "Live world", description: "Compare twelve combinations of particle interaction and environment rules." },
  { title: "Boundaries", href: "/boundaries/", status: "Live world", description: "Compare smooth fields with engineered thresholds and reinforcing walls." },
  { title: "Development", href: "/development/", status: "Live world", description: "Watch inherited body programs grow branching shapes and produce descendants." },
  { title: "Matter", href: "/matter/", status: "Live world", description: "Compare a closed nutrient pool with finite rain and burial." },
  { title: "Currents", href: "/currents/", status: "Live world", description: "Compare nutrient pumps with still-water controls, plus saved replays." },
  { title: "Spatial", href: "/spatial/", status: "Live world", description: "Orbit and slice a genuinely three-dimensional particle world." },
  { title: "Ecosystem", href: "/ecosystem/", status: "Live local sandbox", description: "Costly attack and defense, inherited mutations, refuges and staged rivals. The sandbox starts paused." },
  { title: "Ecosystem archive", href: "/ecosystem/archive/", status: "Saved evidence", description: "Recorded 20,000-tick observations from three seeds, with original summaries and sampled footage." },
  { title: "Vision screen", href: "/vision-screen/", status: "Stopped diagnostic", description: "A stopped visual-selection diagnostic. Its judge did not establish a successful result." },
];

const root = document.querySelector<HTMLDivElement>("#directory");
if (!root) throw new Error("Prototype directory container is missing.");

for (const entry of entries) {
  const article = document.createElement("article");
  article.className = "card";
  const link = document.createElement("a");
  link.className = "card-link";
  link.href = entry.href;
  const heading = document.createElement("h3");
  heading.textContent = entry.title;
  link.append(heading);
  const status = document.createElement("p");
  status.className = "status";
  status.textContent = entry.status;
  const description = document.createElement("p");
  description.className = "description";
  description.textContent = entry.description;
  article.append(link, status, description);
  root.append(article);
}
