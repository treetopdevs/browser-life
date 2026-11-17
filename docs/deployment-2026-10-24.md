# Site, Lab and coordinator deployment — 24 October 2026

Deployed successfully at 22:22 EDT (25 October 02:22 UTC). The user authorized the recommended scope: public site, Lab and coordinator, with the shared garden held private.

## Release and retained recovery material

- Source: `904a05a14aed83fb8c28f22014641dc8a8b902bb`, archived directly from merged main, without source, dependency or Dockerfile changes.
- Archive SHA256: `76d30ac9d403234437481bc91b60420536971a76114d872fb2f696adc8f414bd` (verified on host).
- Native target: existing x86_64 host; existing Compose project `browser-life`, Traefik routing and persistent volumes retained.
- Both images use the full commit as their tag. Site image ID: `sha256:67c30324fcec461faacc0109f5fe88ca7b2f62292bec7ac8e0b2f8152f4d63d0`; coordinator: `sha256:7834f01ac55a69dc60a9762deffd699a7dbe774fa0a7b3ffb2b57554ca74b30e`.
- Current release: `/opt/browser-life/releases/904a05a14aed83fb8c28f22014641dc8a8b902bb`; `/opt/browser-life/current` points there. Owner-only host `.env` selects the same tag.
- Previous release `3f44c319`, its images and configuration remain available.
- Backup directory: `/opt/browser-life/backups/pre-904a05a14aed83fb8c28f22014641dc8a8b902bb`. It contains the previous owner-only environment file, rollback metadata and both data archives. The coordinator was stopped for consistent snapshots before replacing containers; both archives were read back successfully.
- Coordinator archive SHA256: `36a0ce15bdd21481c5f2973a1fc1f28d65d8079bb3898bb57e15532c28a06594`.
- Discovery archive SHA256: `ab3e898e0258b3edfeb2f221ed229ae5a1c07feec680dbdfcd5917f686660dd4`.

## Validation

1. Both images built on the native production architecture using unchanged release recipes. Local ARM builds and smoke tests had passed earlier; local x86 emulation failed in runtime/dependency compilation, so those emulated results were not treated as release proof.
2. An isolated host Compose project with temporary credentials, separate data volumes and a loopback-only port passed 16 HTTP checks. Real Chrome through an SSH tunnel joined, received an idle response and stopped with a confirmed DELETE 204. No page errors or scientific work.
3. After deployment, the same 16 checks passed against public HTTPS: site, Lab, island page, health, aggregate status and robots returned 200; unauthenticated operator status returned 401; authorized coordinator/discovery status returned 200; garden page/API variants and unknown paths returned 404.
4. Runtime configuration confirmed garden scheduling false and per-address island joins unset. The existing proxy trust policy was not changed.
5. Public join 200 and authenticated leave 204 passed without requesting work. The first manual DELETE omitted the required `?island=<id>` parameter and returned 401. The corrected request passed; the first unused smoke registration was removed via a tightly scoped runtime cleanup after checking its exact ID, adapter, user agent, zero completed work and absence from segment attempts. This was a test-harness correction, not an application change.
6. HTTP and www redirected to the HTTPS apex. Real Chrome loaded the live homepage, Lab and island page with no page errors or same-origin HTTP failures.
7. Saved experiment definitions, queue counts and discovery campaigns matched the predeployment snapshots. Final public status: one verified result, zero active islands, one device type. Both containers were running with zero restarts; startup logs contained no error, panic or fatal lines.
8. The temporary host stage containers, network and both temporary volumes were removed. Production volumes were retained. No new campaign, scientific trial, public garden founding, DNS change or proxy trust change was made. No mobile-device validation is claimed.

## Recovery

On the host, use the retained previous release and image tag `3f44c319` with the existing `browser-life` Compose project and its two configuration files. Restore the backed-up `.env` before recreating services with `up -d --no-build --pull never`, then repoint `current` after health checks pass. If data restoration becomes necessary, stop the coordinator first and restore both matching archives; review any postdeployment writes before restoring. Rollback was prepared but not exercised against live data.

Host evidence is under `/opt/browser-life`: `build-904a05a1.log`, `baseline-904a05a1-checks.json`, `stage-904a05a1-checks.json`, `live-904a05a1-checks.json`, and the backup directory's `rollout.json`. Private status snapshots remain owner-only on the host. Local browser evidence is under `/tmp/browser-life-deploy-904a05a1`.
