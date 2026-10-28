// Dashboard theme before first paint: the owner's saved choice (mirrored from Settings
// into localStorage), otherwise the OS setting. src/lib/theme.ts keeps it in sync.
(() => {
  const saved = localStorage.getItem("vellum-theme");
  const dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
