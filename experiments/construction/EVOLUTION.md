# Bounded stationary mutation and transfer assay

Prospective protocol, 2026-10-03; fixed before these runs. This is a dated amendment to the mobility prerequisite in PROTOCOL.md: complete the requested mutation/mechanism factorial on the already validated stationary witness, without requiring another physics extension first. The stationary result cannot establish propagation, invasion resistance or spontaneous individuality.

## Design and stopping rule

Exactly three designed founders, BUILD bias 1, 4 and 8 with all other constructionGenome wiring unchanged; five new source seeds 501–505 per founder; mutation rate 0 or 4,294,967; polymer transport effect on/off. This is 60 source histories, 3,000 steps each, under RULE_VERSION 1 with dtQ=0, spread=0 and motility disabled. Each starts at (16,16) in a 32×32 torus with B=1024, E=2048, P=A=C=S=0. Construction always costs biomass and energy. The ablation is polymerTransport:false, which changes dissolved-resource gating alone.

The one fixed higher mutation dose is approximately 0.001 per synthesised quantum, ten times the default. The reviewed strong witness synthesised about 17,700 B in 3,000 steps, implying only about 1.8 events at default and about 18 at this dose. Weak founders will have less exposure. This is a prospective exposure choice, not an outcome-tuned search. No dose, horizon, founder or seed extension follows a negative result.

With no biomass movement, a mutation overwrites the entire genome at the one occupied site. The previous genotype does not remain to compete, and there is no spatial birth. These are mutation-accumulation histories with differential persistence, not natural selection among reproducing patches. Record that limitation even if improvements are found.

## Source outcomes

Primary ecological outcome: final active B, excluding P. Report all five histories per founder and arm, including extinction as B=0. Also report sampled B-time area (100-step trapezoidal approximation, not exact integrated biomass), cumulative photosynthesis/growth/build expenditure, final P and energy, survival, event counts, terminal genotype, and the number of changes from the ancestor. Mutation-on cannot be described as an effective exposure when no mutation occurred.

Read full state, exact cumulative ledger/flux, last-step role buffer and drain all mutation events every 100 steps. Assert constant matter, zero energy residual, valid state, zero off-site B, no dropped events and zero mutation events when mutation is disabled. Preserve final checkpoint, hash, all event rows and census traces. Last-step roles describe that step, not the intervening 100 steps.

## Controlled transfer

Take only the terminal genome of each surviving source history (final B>0); never pick the best earlier genotype. Reconstitute it and its corresponding designed ancestor separately at exactly B1024/E2048, P=A=C=S=0, under the same stationary RULE_VERSION 1 habitat, mutation disabled, on each fresh seed 601–603, with the transport mechanism both on and off. This laboratory genome reconstitution resets matter/energy and environment; it is not a naturally founded offspring or demonstrated ecological transmission.

Every terminal survivor is transferred, including survivors from source mechanism-off arms. Exact duplicate genomes reuse transfer assays only when full config, initial state and transfer seed are identical. For extinct source histories, the primary descendant transfer outcome is zero in both gardens and the ancestor retains its actual paired outcome. Do not omit extinct histories, resurrect their last viable genomes, or average only over survivors. Conditional-survivor means may be shown separately with explicit counts.

Three transfer seeds are repeated technical/ecological assay trials for one source genome. They do not increase the number of independent source histories above five per founder per arm.

## Prospective exploratory readout

For source founder f and seed s, define E as final B in mutation-on/mechanism-on minus mutation-off/mechanism-on. Define T_on and T_off as the mean descendant-minus-ancestor final B over the three transfer seeds in the respective gardens, with extinct sources assigned zero descendant outcome as above.

A source history meets the combined improvement criterion only when E>0, T_on>0 and T_off<=0. A founder counts only if its mean E over all five histories is positive and at least three of its five mutation-on/mechanism-on histories meet that combined criterion. The screen is positive only if at least two of the three founders count. These sign criteria are a small exploratory screen, not a calibrated significance test or evidence of sustained adaptation. Report raw differences so small changes remain visible.

Also report mutation-on/off differences in the source mechanism-off arms and their difference-in-differences relative to mechanism-on. If mechanism-off transfer arms all die, T_off=0 is an extinction-floor result: it establishes no surviving transfer advantage in that habitat, not a finely resolved comparison of variant mechanisms. Sampled area and flux differences help disclose this limitation but do not change the label.

A negative completes this bounded assay: record mutation load, persistence and transfer outcomes without retuning. A positive establishes a finite, genetically transferable improvement found during mutation accumulation in this constructed habitat. It does not establish population-level reproductive selection, emergence of cells, open-endedness or success of the moving witness.

## Conditional second opportunity

Only after a positive screen, test a separately specified recipient phenotype against evolved builder, ancestor, cost-preserving mechanism ablation and equal-resource nonliving-donor controls. Require the recipient's improved persistence/resource assimilation to depend on a resource or habitat created by the living construction, while accounting for donor performance. Improved BUILD tuning, persistence or another descendant of the same retention strategy is not a second opportunity. If this screen is negative, the second-opportunity premise remains unearned and no extra search is triggered.

The runner records source hashes and copies this protocol and executable sources into its fresh output directory before acquiring a GPU or simulating. Any harness correction preserves the original output and is recorded as a new run.
