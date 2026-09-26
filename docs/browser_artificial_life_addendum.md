# Addendum: Building the Life-Like Simulation in a Browser

*September 24, 2026. Companion to “Simulating Life-Like, Emergent, and ‘Anti-Entropic’ Systems.” This is an implementation proposal, not evidence that a chosen substrate will produce open-ended evolution.*

## Recommendation

Start with **TypeScript + WebGPU/WGSL** for a two-dimensional resource–biomass–waste world. Keep simulation state on the GPU, use a dedicated worker to run fixed simulation steps, render directly from GPU state, and persist occasional versioned checkpoints to OPFS. Begin with a 256 × 256 or 512 × 512 grid and a modest number of channels. A CPU/Wasm reference implementation should run the same local rules at small scale for conservation and regression checks. Once sustained self-maintenance and reproduction have been demonstrated, add heritable local parameters and ecological variation.

This recommendation is an engineering inference from WebGPU's compute and rendering model and the report's proposed experiment. It is **not** a claim that WebGPU itself solves emergence, heredity, or the measurement problem. [WebGPU specification](https://www.w3.org/TR/webgpu/) · [WGSL specification](https://www.w3.org/TR/WGSL/) · [Google's cellular-automaton WebGPU codelab](https://codelabs.developers.google.com/your-first-webgpu-app)

## Technology choices

| Component | First choice | When to change it |
| --- | --- | --- |
| UI and experiment controls | TypeScript, lightweight UI framework, Canvas | Any familiar frontend stack works; avoid tying scientific state to UI components. |
| Dense CA, diffusion, local reaction, rendering | WebGPU compute and render pipelines; WGSL | WebGL2 fallback only for a narrower visualization or small fragment-shader simulation. |
| Simulation orchestration | Dedicated Web Worker; use OffscreenCanvas where supported | Main-thread rendering may be simpler initially; retain fixed-step scheduling independently of `requestAnimationFrame`. |
| Reference model, sparse graph/agent logic, analysis | TypeScript CPU first; Rust/Wasm if profiling warrants | Rust `wgpu` is attractive if a shared browser/native GPU engine becomes a requirement, but adds bindings and build complexity. |
| Checkpoints and experiment metadata | OPFS for binary snapshots; IndexedDB for indexes and searchable run metadata | Offer export/import of a portable run bundle because browser storage can be evicted or cleared. |
| Offline use | Service worker caches application assets | A service worker does not keep a long GPU simulation alive when the tab is closed. |

WebGPU availability varies by browser, operating system, GPU, and driver; detect `navigator.gpu`, request an adapter/device, inspect `adapter.limits` and `adapter.features`, and offer a reduced CPU path if acquisition fails. Use HTTPS or localhost. Recent browser support includes Chrome, Safari 26, and Firefox on supported desktop platforms, but test the actual target devices rather than treating a browser name as a guarantee. [MDN WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) · [Chrome WebGPU overview](https://developer.chrome.com/docs/web-platform/webgpu/overview) · [WebKit Safari 26.2 notes](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/)

## A concrete first world

Each grid cell stores resource `R`, biomass `B`, waste `W`, and optionally one or more local controller/parameter channels. One compute pass moves or diffuses material using local neighborhoods. A second pass applies growth, maintenance cost, waste production, and decay. A third pass handles movement or flow. The simplest conceptual budget is: resource consumed by a catalyst may increase biomass and waste, while external inflow and waste removal occur only at explicit reservoirs. Define exact units and verify the accounting equation for every step; do not call an arbitrary scalar thermodynamic entropy.

Allocate two state buffers or texture sets, `A` and `B`. Each update reads one complete state and writes the next; swap their roles after the pass. Never depend on the scheduling order of neighboring invocations. The official WebGPU boids example uses the same ping-pong approach for particles, and Google's Game of Life tutorial explains it for a grid. [Compute boids sample](https://webgpu.github.io/webgpu-samples/?sample=computeBoids) · [Game of Life codelab](https://codelabs.developers.google.com/your-first-webgpu-app)

Use `f32` storage for an initial implementation and fixed-size dimensions. Decide explicitly whether the world wraps at its edges or has physical boundary reservoirs. Local reaction rules can use one invocation per cell; multi-cell redistribution must avoid conflicting writes. A safe first version is **gather-based**: each output cell computes its incoming flux from neighboring input cells, so only one invocation writes that output. Floating-point reductions and GPU implementations can diverge across hardware; save seeds, parameters, shader/build version, and periodic state hashes, but do not promise bitwise replay across devices without testing it.

Keep rendering on the GPU: sample the current state in a render pass and color cells by selected field or derived measure. Copy compact aggregate metrics and occasional checkpoints back to the CPU; full-frame readback every animation frame would undermine the GPU-resident design. Use a fixed `dt` and separate simulation ticks from display frames; let users pause, single-step, speed up, and inspect local neighborhoods. GPU limits, device loss, and validation errors need explicit handling. [WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) · [WebGPU specification](https://www.w3.org/TR/webgpu/)

## Architecture and persistence

1. **UI thread:** configuration, visualization controls, run comparison, plots, and export controls.
2. **Simulation worker:** owns device/pipelines, fixed-step loop, bounded commands from UI, and asynchronous metric/checkpoint requests. Use OffscreenCanvas in the worker if the target browsers support the chosen canvas path. [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
3. **GPU state:** two field sets plus compact metrics/reduction buffers. Keep readbacks infrequent and do not map a buffer still used by GPU work.
4. **Storage worker or simulation worker:** versioned binary snapshots in OPFS; IndexedDB run manifest with seed, rule version, parameters, timestamps, browser/GPU information, and summaries. OPFS is origin private and subject to quota/eviction; provide explicit export and import. Its synchronous access handle is available inside dedicated workers. [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) · [synchronous access handle](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle) · [storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

Checkpoint at known step boundaries: finish queued GPU work, copy state into a staging buffer, read it asynchronously, write a snapshot with checksum and schema version, then commit its manifest entry. On restore, validate dimensions, schema, checksum, and rule version before uploading state. Expect a closed tab to stop computation. A PWA helps reload assets offline; continuing long runs across tab closure would require a separate compute host or a user-managed desktop process. [Offline PWAs](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)

## WebGPU, WebAssembly, and the user's Elixir interests

There are two viable implementation routes:

| Route | Benefit | Cost / caveat |
| --- | --- | --- |
| TypeScript calling WebGPU directly | Fastest iteration on WGSL kernels and browser tooling; easy worker/UI integration | A future native simulator would need a second host layer. |
| Rust core compiled to Wasm with `wgpu` | More shared logic across browser and native runs; Rust can host CPU model and analysis | Browser GPU still goes through WebGPU; Rust/Wasm does not remove browser device or storage limits. Bindings and async lifecycle add work. |

The `wgpu` project documents both browser WebGPU and native backends. An Elixir/Phoenix application could manage experiment definitions, share presets, collect opt-in run manifests, and coordinate server-side batch jobs; the browser simulation can remain local. Lattice/Popcorn-style browser-local BEAM is interesting for collaborative experiment orchestration or shared observations, but the dense cell update should stay in WGSL until measurements show otherwise. This division is a design inference, not a claim of proven compatibility between those projects. [wgpu browser documentation](https://wgpu.rs/doc/wgpu/documentation/platforms/web/index.html) · [wgpu overview](https://wgpu.rs/doc/wgpu/)

Wasm threads and `SharedArrayBuffer` are optional optimizations for CPU-side analysis or sparse agents, and cross-origin isolation must be configured before shared memory is available. Do not require them for the first WebGPU prototype. [SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)

## When the substrate changes

**Flow-Lenia-like continuous fields:** WebGPU is a natural fit for pointwise updates and local convolution. Large-radius or many-kernel convolution may require separable kernels or FFT-like methods; benchmark before committing to either. Add localized mutable parameters only after basic numerical stability and conservation checks pass.

**Particle Life or mobile agents:** GPU buffers and spatial bins can scale high particle counts, but neighbor search, compaction, birth/death, and variable-length genomes complicate the pipeline. Start with a capped particle pool and an explicit free-list or live mask. If interactions are sparse and branching dominates, a CPU/Wasm model may be easier and faster at modest population sizes.

**Artificial chemistry:** Represent a small fixed set of species as channels first. Dynamic species and arbitrary reaction graphs are harder to express in fixed WGSL pipelines; a CPU/Wasm chemistry engine may be the right reference system while the GPU handles diffusion and rendering.

**Neural CA:** Small fixed local networks can be hand-written in WGSL. Training through long differentiable rollouts requires a separate choice of autodiff tooling and memory strategy; do not assume browser inference implies practical browser training.

## Experiment and acceptance gates

The browser app should log resource inflow, outflow, totals, and numerical residuals; mutation/reproduction events; occupancy and connected-component sizes; perturbation recovery; lineage ancestry if explicit heredity is added; and held-out novelty measures. Run neutral, no-mutation, no-resource, and fixed-environment controls using the same seed protocol. Visual beauty or a single long run does not establish increasing organized complexity.

The first milestone is intentionally small: a world that runs for 100,000 fixed steps without numerical explosion, conserves or accounts for every tracked material under documented reservoir rules, can resume from a checkpoint, and can replay a short run on the same tested device/build. The second milestone is a self-maintaining localized form that recovers from a defined lesion. The third is heritable reproduction with lineages and controls. Only then assess whether organizational and ecological measures continue growing across independent histories.

Practical performance gates: profile GPU time and memory on a desktop and a midrange mobile device; test long-running device loss and restoration; cap dimensions against queried device limits; compare aggregate outputs with the small CPU reference; and report simulation steps per second separately from render frames per second. WebGPU timestamp queries are optional and must be feature-detected. [WebGPU limits](https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedLimits) · [Chrome GPU timing notes](https://developer.chrome.com/docs/web-platform/webgpu/developer-features)
