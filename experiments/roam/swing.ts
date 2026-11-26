/**
 * Classifies roam runs with kinds by how armour and hunters went, from look.ts logs (one "kinds:" line per report).
 *
 *   deno run -A --no-lock experiments/roam/swing.ts runs/roam/sweep/*.log
 *
 * From step 20,000 on (the founders' first growth left out):
 * - "hunters only": shells below 20 in at least 80% of reports.
 * - "armour takes over": mouths below 20 in the last quarter of reports, or shells at least 3 times mouths in all of
 *   the last quarter with no swing.
 * - "swings": shells and mouths both at least 20 in at least 80% of reports, and at least 2 turns in the shell count,
 *   each a move of at least 30% from the last turning point (counted from at least 50), so a fall and a rise back.
 * - otherwise "mixed".
 * A probe tool with rules fixed before reading the sweep, not a test.
 */

const FROM = 20000;
for (const path of Deno.args) {
  const text = Deno.readTextFileSync(path);
  const steps = [...text.matchAll(/^ *(\d+) +\d+ /gm)].map((m) => Number(m[1]));
  const kinds = [...text.matchAll(/kinds: (\d+) shells, (\d+) mouths/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const rows = kinds.map(([sh, mo], i) => ({ step: steps[i], sh, mo })).filter((r) => r.step >= FROM);
  if (rows.length < 4) { console.log(`${path}: too few reports`); continue; }
  const share = (f: (r: { sh: number; mo: number }) => boolean, rs = rows) => rs.filter(f).length / rs.length;
  // Turns in the shell count: after the first move of 30% (from at least 50), each later reversal of 30% from the
  // extreme since the last turn is a turn. A rise must reach at least 50.
  let turns = 0;
  let dir = 0;
  let hi = rows[0].sh;
  let lo = rows[0].sh;
  let ext = 0;
  for (const { sh: v } of rows.slice(1)) {
    if (dir === 0) {
      hi = Math.max(hi, v); lo = Math.min(lo, v);
      if (hi >= 50 && v <= 0.7 * hi) { dir = -1; ext = v; }
      else if (v >= 50 && v >= Math.max(lo, 35) * 1.3) { dir = 1; ext = v; }
    } else if (dir === 1) {
      if (v > ext) ext = v;
      else if (v <= 0.7 * ext) { turns++; dir = -1; ext = v; }
    } else {
      if (v < ext) ext = v;
      else if (v >= 50 && v >= Math.max(ext, 35) * 1.3) { turns++; dir = 1; ext = v; }
    }
  }
  const last = rows.slice(Math.floor(rows.length * 0.75));
  const both = share((r) => r.sh >= 20 && r.mo >= 20);
  let verdict = 'mixed';
  if (share((r) => r.sh < 20) >= 0.8) verdict = 'hunters only';
  else if (both >= 0.8 && turns >= 2) verdict = 'swings';
  else if (share((r) => r.mo < 20, last) === 1 || share((r) => r.sh >= 3 * r.mo, last) === 1) verdict = 'armour takes over';
  const tail = rows.filter((_, i) => i % 4 === 0 || i === rows.length - 1).map((r) => `${r.step / 1000}k ${r.sh}/${r.mo}`).join(', ');
  console.log(`${path.split('/').pop()?.replace('.log', '')}: ${verdict} (both present ${Math.round(both * 100)}%, ${turns} turns) | shells/mouths ${tail}`);
}
