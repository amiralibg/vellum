"""Builds Vellum's logo files from one definition of the mark.

The mark is two translucent sheets: vellum laid on vellum, solid where they overlap.
Run from the repo root:  python3 packages/ui/logo/build.py
Needs fontTools (with brotli), resvg and ImageMagick (`magick`).
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
PUBLIC = ROOT / "apps/web/public"
FONT = ROOT / "packages/ui/fonts/Geist-Variable.woff2"

INK = "#1c1a17"  # --ink-900, the light theme's ink
BONE = "#f2f1ee"  # --bone-100, the dark theme's ink
PAPER = "#f6f4ef"  # --paper-100, the light canvas

# The mark on a 64 grid: back sheet, front sheet, and their overlap (front's top-left corner, back's bottom-right).
BACK = '<rect x="6" y="4" width="34" height="44" rx="6" fill-opacity=".28"/>'
FRONT = '<rect x="24" y="16" width="34" height="44" rx="6" fill-opacity=".55"/>'
OVERLAP = '<path d="M30 16H40V42A6 6 0 0 1 34 48H24V22A6 6 0 0 1 30 16Z"/>'
MARK = BACK + FRONT + OVERLAP


def mark_svg(color: str, size: int | None = None, extra: str = "") -> str:
    dims = f' width="{size}" height="{size}"' if size else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"{dims}>{extra}<g fill="{color}">{MARK}</g></svg>\n'


def wordmark(size: float, x: float, baseline: float) -> tuple[str, float, float]:
    """"Vellum" in Geist 600 as outlines, tracked like the dashboard's .wordmark. Returns path, width, cap height."""
    font = instancer.instantiateVariableFont(TTFont(FONT), {"wght": 600})
    upm, cmap, glyphs, hmtx = font["head"].unitsPerEm, font.getBestCmap(), font.getGlyphSet(), font["hmtx"]
    scale, tracking = size / upm, -0.035 * size
    pen, cx = SVGPathPen(glyphs), x
    for ch in "Vellum":
        name = cmap[ord(ch)]
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, cx, baseline)))
        cx += hmtx[name][0] * scale + tracking
    d = re.sub(r"-?\d+\.\d+", lambda m: f"{float(m.group()):.2f}".rstrip("0").rstrip("."), pen.getCommands())
    return d, cx - tracking - x, font["OS/2"].sCapHeight * scale


def logo_svg(color: str) -> str:
    # The wordmark's capitals sit centred on the mark.
    size, gap = 56, 12
    _, _, cap = wordmark(size, 0, 0)
    baseline = 32 + cap / 2
    d, width, _ = wordmark(size, 64 + gap, baseline)
    w = round(64 + gap + width + 2)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} 64">'
            f'<g fill="{color}">{MARK}<path d="{d}"/></g></svg>\n')


def png(svg: str, out: Path, size: int, background: str | None = None):
    tmp = OUT / ".tmp.svg"
    tmp.write_text(svg)
    cmd = ["resvg", "-w", str(size), "-h", str(size)] + (["--background", background] if background else [])
    subprocess.run(cmd + [str(tmp), str(out)], check=True)
    tmp.unlink()


def app_icon(size: int) -> str:
    """Square, full-bleed paper (iOS and Android round it themselves), the mark at 68%."""
    inset = 64 * 0.16
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="{PAPER}"/>'
            f'<g transform="translate({inset} {inset}) scale({1 - 2 * inset / 64})" fill="{INK}">{MARK}</g></svg>')


if __name__ == "__main__":
    (OUT / "vellum-mark.svg").write_text(mark_svg(INK))
    (OUT / "vellum-mark-dark.svg").write_text(mark_svg(BONE))
    (OUT / "vellum-logo.svg").write_text(logo_svg(INK))
    (OUT / "vellum-logo-dark.svg").write_text(logo_svg(BONE))
    png(logo_svg(INK), OUT / "vellum-logo.png", 1200)
    png(logo_svg(BONE), OUT / "vellum-logo-dark.png", 1200)

    # Favicon: follows the OS theme, like the dashboard does by default.
    style = f"<style>g{{fill:{INK}}}@media (prefers-color-scheme:dark){{g{{fill:{BONE}}}}}</style>"
    (PUBLIC / "favicon.svg").write_text(mark_svg(INK, extra=style).replace(f'<g fill="{INK}">', "<g>"))
    for s in (16, 32, 48):
        png(mark_svg(INK), OUT / f".ico-{s}.png", s)
    subprocess.run(["magick", *[str(OUT / f".ico-{s}.png") for s in (16, 32, 48)], str(PUBLIC / "favicon.ico")], check=True)
    for s in (16, 32, 48):
        (OUT / f".ico-{s}.png").unlink()

    png(app_icon(180), PUBLIC / "apple-touch-icon.png", 180)
    png(app_icon(192), PUBLIC / "icon-192.png", 192)
    png(app_icon(512), PUBLIC / "icon-512.png", 512)
    print("Wrote", ", ".join(p.name for p in sorted(OUT.glob("vellum-*"))), "and the icons in apps/web/public")
