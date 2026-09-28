type Theme = "dark" | "light";

const key = "browser-life-theme";
const root = document.documentElement;
const stored = (() => {
  try { return localStorage.getItem(key); } catch { return null; }
})();
let current: Theme = stored === "light" || stored === "dark" ? stored : "dark";

function applyTheme() {
  root.dataset.theme = current;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".theme-toggle")) {
    button.textContent = current === "dark" ? "Light mode" : "Dark mode";
    button.setAttribute("aria-label", `Switch to ${current === "dark" ? "light" : "dark"} mode`);
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
