// Every page loads this module, so it is also where the page-view counter starts.
import "./analytics.ts";

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
  // Tab order follows what is drawn. Wide, the button ends the row after the nav; at 1000px and below the nav takes
  // a row of its own under the name (site.css), so the button, drawn beside the name, comes before it in the markup.
  const nav = publicHeader.querySelector(".site-nav");
  const narrow = matchMedia("(max-width: 1000px)");
  const place = () => {
    const focused = document.activeElement === button;
    if (narrow.matches && nav) nav.before(button);
    else publicHeader.append(button);
    if (focused) button.focus();
  };
  place();
  narrow.addEventListener("change", place);
}

// The sticky header wraps onto more lines on narrow screens. Its height, as it stands, feeds `scroll-padding-top`
// in site.css, so a skip-link jump, an anchor or a control reached with Shift+Tab is never left under it.
const siteHeader = document.querySelector<HTMLElement>(".site-header");
if (siteHeader) {
  const measure = () => root.style.setProperty("--site-header-height", `${Math.ceil(siteHeader.getBoundingClientRect().height)}px`);
  measure();
  if (typeof ResizeObserver === "function") new ResizeObserver(measure).observe(siteHeader);
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".theme-toggle")) {
  button.addEventListener("click", () => {
    current = current === "dark" ? "light" : "dark";
    try { localStorage.setItem(key, current); } catch { /* The chosen theme still applies for this page. */ }
    applyTheme();
  });
}
applyTheme();
