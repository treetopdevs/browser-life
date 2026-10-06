type Theme = "dark" | "light";

const key = "browser-life-theme";
const root = document.documentElement;
const stored = (() => {
  try { return localStorage.getItem(key); } catch { return null; }
})();
// Day is the default: warm paper around a dark jar. Night keeps the same roles in dusk colours.
let current: Theme = stored === "light" || stored === "dark" ? stored : "light";

function applyTheme() {
  root.dataset.theme = current;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".theme-toggle")) {
    button.textContent = current === "dark" ? "Day" : "Night";
    button.setAttribute("aria-label", `Switch to ${current === "dark" ? "day" : "night"} colours`);
    button.title = `Switch to ${current === "dark" ? "day" : "night"} colours`;
  }
  window.dispatchEvent(new Event("browser-life-theme-change"));
}

// Public pages share a header but do not need a different template for the switch.
const publicHeader = document.querySelector(".site-header .header-inner");
if (publicHeader && !publicHeader.querySelector(".theme-toggle")) {
  const button = document.createElement("button");
  button.className = "theme-toggle";
  button.type = "button";
  publicHeader.append(button);
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".theme-toggle")) {
  button.addEventListener("click", () => {
    current = current === "dark" ? "light" : "dark";
    try { localStorage.setItem(key, current); } catch { /* The chosen theme still applies for this page. */ }
    applyTheme();
  });
}
applyTheme();
