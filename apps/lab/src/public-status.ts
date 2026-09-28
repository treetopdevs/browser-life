type PublicStatus = {
  counts: Record<string, number>;
  activeIslands: number;
  deviceTypes: number;
  updatedAt: string;
};

const byId = (id: string) => document.getElementById(id)!;
const message = byId("status-message");
const grid = byId("status-grid");
const updated = byId("status-updated");
let refreshing = false;

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const response = await fetch("/api/public/status", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const status = await response.json() as PublicStatus;
    const entries: [string, number][] = [
      ["count-pending", status.counts.pending ?? 0],
      ["count-running", status.counts.assigned ?? 0],
      ["count-done", status.counts.done ?? 0],
      ["count-verified", status.counts.verified ?? 0],
      ["count-islands", status.activeIslands],
      ["count-devices", status.deviceTypes],
    ];
    for (const [id, value] of entries) byId(id).textContent = Number.isFinite(value) ? value.toLocaleString() : "—";
    updated.textContent = `Last checked ${new Date(status.updatedAt).toLocaleString()}. Refreshes every 30 seconds.`;
    const hasSegments = Object.values(status.counts).some((count) => count > 0);
    message.textContent = hasSegments
      ? "Coordinator connected."
      : "Coordinator connected. No experiments are queued yet; joined islands will wait for work.";
    grid.hidden = false;
  } catch {
    message.textContent = "Live status is unavailable right now. The lab and research notes are still available.";
    updated.textContent = "";
    grid.hidden = true;
  } finally {
    refreshing = false;
  }
}

void refresh();
setInterval(() => void refresh(), 30_000);
