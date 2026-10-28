// Vellum reader: reading progress, active TOC entry, minutes left, print button, view beacons.
// Plain script, no dependencies, so the reader page stays fast.
(() => {
  const bar = document.querySelector(".progress");
  const left = document.querySelector("[data-minutes-left]");
  const total = left ? Number(left.dataset.minutesLeft) : 0;
  const links = [...document.querySelectorAll(".toc a")];
  const heads = links.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1))));

  let queued = false;
  function update() {
    queued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(1, scrollY / max) : 1;
    if (bar) bar.style.transform = `scaleX(${p})`;
    if (left) left.textContent = String(Math.max(0, Math.ceil(total * (1 - p))));
    let active = 0;
    heads.forEach((h, i) => {
      if (h && h.getBoundingClientRect().top < innerHeight * 0.3) active = i;
    });
    links.forEach((a, i) => a.setAttribute("aria-current", i === active ? "true" : "false"));
    measure();
  }

  // Views. The server counts one on the first beacon, never on render, so link previews that only fetch
  // the page don't count. Later beacons carry how far the reader got and how long the tab was visible.
  // HTML documents send the first beacon only: the page itself is sandboxed on another origin.
  const { view: token, beacon: beaconUrl } = document.body.dataset;
  const tracking = Boolean(token && beaconUrl && navigator.sendBeacon);
  const reading = tracking && !document.body.classList.contains("is-site");
  const article = document.querySelector(".prose");
  const reached = new Set();
  let depth = 0;
  let visibleMs = 0;
  let visibleSince = null;
  let sent = false;

  function measure() {
    if (!reading) return;
    if (article) {
      const r = article.getBoundingClientRect();
      const p = r.height > 0 ? ((innerHeight - r.top) / r.height) * 100 : 100;
      depth = Math.max(depth, Math.round(Math.min(100, Math.max(0, p))));
    }
    heads.forEach((h) => {
      if (h && h.getBoundingClientRect().top < innerHeight * 0.85) reached.add(h.id);
    });
  }
  const seconds = () => Math.round((visibleMs + (visibleSince === null ? 0 : performance.now() - visibleSince)) / 1000);
  function send() {
    if (!tracking || (sent && !reading)) return;
    const body = reading ? { t: token, s: depth, h: [...reached], a: seconds() } : { t: token };
    if (navigator.sendBeacon(beaconUrl, JSON.stringify(body))) sent = true;
  }
  function visibility() {
    if (document.visibilityState === "visible") {
      visibleSince ??= performance.now();
      // A tab opened in the background counts once someone looks at it.
      if (!sent) send();
    } else {
      if (visibleSince !== null) visibleMs += performance.now() - visibleSince;
      visibleSince = null;
      if (sent) send();
    }
  }
  if (tracking) {
    addEventListener("visibilitychange", visibility);
    addEventListener("pagehide", () => sent && send());
    if (reading) setInterval(() => document.visibilityState === "visible" && sent && send(), 30_000);
  }
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule, { passive: true });
  update();
  if (tracking) visibility();

  document.querySelector("[data-print]")?.addEventListener("click", () => print());

  // HTML documents: the sharing pill collapses to just the avatar and the toggle.
  const pill = document.querySelector(".pill");
  const toggle = document.querySelector("[data-pill-toggle]");
  toggle?.addEventListener("click", () => {
    const collapsed = pill.dataset.collapsed !== "true";
    pill.dataset.collapsed = String(collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Show sharing bar" : "Hide sharing bar");
  });
})();
