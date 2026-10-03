# Discovering worlds that support cumulative evolution

2026-10-04 · Research and proposal · Implementation and scientific runs not started

Build an experimental workbench that measures what our physics permits, searches for diverse promising regimes, and then tests whether evolution can discover and extend those capabilities. Distribute independent cases across the Mac, a work laptop, other desktops, and optional AWS workers through the existing Phoenix coordinator.

The strongest external starting point is [Flow-Lenia universe discovery](https://arxiv.org/html/2505.15998v1): search the space of worlds, keeping a repertoire of outcomes. Our contribution would be stronger capability tests, causal controls, exact replay, and a separate test of evolutionary accessibility. This is a proposed adaptation of that method, not a reproduced result.

Read in order:

1. [Research and reuse decisions](/Users/nicholas/develop/browser-life/docs/evolvability-discovery-2026-10-04/RESEARCH.md): primary sources, available software, limitations, and current repository evidence.
2. [PRD](/Users/nicholas/develop/browser-life/docs/evolvability-discovery-2026-10-04/PRD.md): scientific questions, user experience, requirements, and acceptance criteria.
3. [Technical design](/Users/nicholas/develop/browser-life/docs/evolvability-discovery-2026-10-04/DESIGN.md): assays, search, data contracts, and distributed execution.
4. [Implementation and experiment plan](/Users/nicholas/develop/browser-life/docs/evolvability-discovery-2026-10-04/PLAN.md): bounded stages, dependencies, compute rollout, and stopping rules.
5. [Fable council packet](/Users/nicholas/develop/browser-life/docs/evolvability-discovery-2026-10-04/COUNCIL.md): concrete adversarial questions and unresolved decisions.

Recommendation: extend the existing Elixir/TypeScript system. Use browser WebGPU or headless Deno workers, and add a CPU worker for small diagnostic cases. Defer WASM, a second scheduler, and new chemistry until measurements justify them. A worker receives a case, computes it locally, and uploads a content-addressed result; machines never exchange live simulation cells.

These documents are a new proposal. They do not amend frozen experiments, replace the construction workspace's renewal protocol, or certify deployed infrastructure. Only this directory was created for this request; no worker, service, experiment, or AWS resource was started.

**Review status:** Fable and Sol reviews are pending. This side conversation prohibits sub-agents, so neither reviewer was invoked. The earlier construction review was inspected as prior evidence; it is not review or endorsement of this proposal.
