import type { ThemePreference } from "@vellum/shared";

const KEY = "vellum-theme";
const media = matchMedia("(prefers-color-scheme: dark)");
let preference: ThemePreference = (localStorage.getItem(KEY) as ThemePreference | null) ?? "system";

function apply() {
  const dark = preference === "dark" || (preference === "system" && media.matches);
  const root = document.documentElement;
  // Swap colors in one frame instead of fading every transition.
  root.classList.add("theme-switching");
  root.dataset.theme = dark ? "dark" : "light";
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
}

media.addEventListener("change", () => {
  if (preference === "system") apply();
});

/** Applies the owner's saved theme and mirrors it to localStorage for the next first paint. */
export function setThemePreference(next: ThemePreference) {
  preference = next;
  if (next === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, next);
  apply();
}
