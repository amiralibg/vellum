// Theme: a saved choice wins, otherwise follow the OS. Loaded in <head> (not deferred)
// so the right theme is applied before first paint.
(() => {
  const KEY = "vellum-theme";
  const root = document.documentElement;
  const media = matchMedia("(prefers-color-scheme: dark)");
  const saved = () => localStorage.getItem(KEY);
  const current = () => saved() ?? (media.matches ? "dark" : "light");

  root.dataset.theme = current();
  media.addEventListener("change", () => {
    if (!saved()) apply(current());
  });

  function apply(theme) {
    // Suppress transitions for one frame so colors swap at once instead of fading.
    root.classList.add("theme-switching");
    root.dataset.theme = theme;
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
    if (toggle) render();
  }

  let toggle;
  const icons = {
    dark: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M13.25 9.5A5.5 5.5 0 0 1 6.5 2.75a5.5 5.5 0 1 0 6.75 6.75Z" stroke-linejoin="round"/></svg>',
    light: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" stroke-linecap="round"/></svg>',
  };
  function render() {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    toggle.innerHTML = `${icons[next]}${next === "dark" ? "Dark" : "Light"}`;
    toggle.setAttribute("aria-label", `Switch to ${next} theme`);
  }

  // Mockup chrome: group "All screens" with a theme toggle in one bottom-left bar.
  addEventListener("DOMContentLoaded", () => {
    const bar = document.createElement("div");
    bar.className = "mock-bar";
    const nav = document.querySelector(".mock-nav");
    if (nav) bar.append(nav);
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "mock-nav";
    toggle.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      localStorage.setItem(KEY, next);
      apply(next);
    });
    render();
    bar.append(toggle);
    document.body.append(bar);
  });
})();
