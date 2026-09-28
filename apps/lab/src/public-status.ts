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

async function refresh(): Promise<void> {
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
    message.textContent = "Coordinator connected.";
    grid.hidden = false;
  } catch {
    message.textContent = "Live status is unavailable right now. The lab and research notes are still available.";
    updated.textContent = "";
    grid.hidden = true;
  }
}

void refresh();
setInterval(() => void refresh(), 30_000);
