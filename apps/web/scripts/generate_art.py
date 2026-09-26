#!/usr/bin/env python3
"""Generates Aurora's original SVG art set.

Everything is drawn from primitives so no third-party asset is ever committed.
Each game cover keys off that game's themeColor; the whole set shares one visual
language: dark base, radial glow, thin gold rim.

Run:  python3 apps/web/scripts/generate_art.py
"""
from __future__ import annotations

import math
import pathlib

OUT = pathlib.Path(__file__).resolve().parents[1] / "public"

THEME = {
    "slots": "#7c3aed",
    "roulette": "#dc2626",
    "blackjack": "#0ea5e9",
    "crash": "#f43f5e",
    "mines": "#10b981",
    "plinko": "#3b82f6",
    "limbo": "#ec4899",
    "keno": "#f59e0b",
    "dice": "#8b5cf6",
}


def write(rel: str, svg: str) -> None:
    target = OUT / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(svg.strip() + "\n", encoding="utf-8")


def shell(gid: str, color: str, body: str, dark: str = "#0b0d14", mid: str = "#151925") -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400" role="img">
  <defs>
    <linearGradient id="bg{gid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{mid}"/><stop offset="1" stop-color="{dark}"/>
    </linearGradient>
    <radialGradient id="glow{gid}" cx="50%" cy="38%" r="62%">
      <stop offset="0" stop-color="{color}" stop-opacity="0.55"/>
      <stop offset="0.55" stop-color="{color}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="{color}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rim{gid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f0c674" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#d6a84f" stop-opacity="0.05"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="url(#bg{gid})"/>
  <rect width="400" height="400" fill="url(#glow{gid})"/>
  {body}
  <rect x="0.5" y="0.5" width="399" height="399" fill="none" stroke="url(#rim{gid})" stroke-width="1.5"/>
</svg>"""


# ── individual game covers ───────────────────────────────

def slots(c: str, gid: str) -> str:
    reels = ""
    for i, x in enumerate((-74, 0, 74)):
        if i == 1:
            symbol = '<path d="M0 -28 L8 -9 L28 -9 L12 3 L18 23 L0 11 L-18 23 L-12 3 L-28 -9 L-8 -9 Z" fill="#f0c674"/>'
            dy = -8
        elif i == 0:
            symbol = f'<path d="M0 -26 L22 0 L0 26 L-22 0 Z" fill="{c}" fill-opacity="0.95"/>'
            dy = 12
        else:
            symbol = f'<circle r="20" fill="{c}" fill-opacity="0.9"/><circle r="9" fill="#0b0d14" fill-opacity="0.6"/>'
            dy = 12
        reels += (
            f'<rect x="{x - 32}" y="-78" width="64" height="156" rx="11" '
            f'fill="{c}" fill-opacity="0.11" stroke="{c}" stroke-opacity="0.32"/>'
            f'<g transform="translate({x} {dy})">{symbol}</g>'
        )
    return shell(
        gid, c,
        f'<g transform="translate(200 205)">'
        f'<rect x="-116" y="-96" width="232" height="192" rx="18" fill="#0a0c12" '
        f'stroke="{c}" stroke-opacity="0.4" stroke-width="2"/>{reels}'
        f'<rect x="-116" y="96" width="232" height="16" rx="8" fill="{c}" fill-opacity="0.28"/>'
        f'</g>',
    )


def roulette(c: str, gid: str) -> str:
    segs = ""
    r = 104
    for i in range(12):
        a0 = math.radians(i * 30)
        a1 = math.radians((i + 1) * 30)
        x0, y0 = math.sin(a0) * r, -math.cos(a0) * r
        x1, y1 = math.sin(a1) * r, -math.cos(a1) * r
        col = c if i % 2 == 0 else "#0d1018"
        op = 0.85 if i % 2 == 0 else 1
        segs += (
            f'<path d="M0 0 L{x0:.1f} {y0:.1f} A{r} {r} 0 0 1 {x1:.1f} {y1:.1f} Z" '
            f'fill="{col}" fill-opacity="{op}" stroke="#000" stroke-opacity="0.4"/>'
        )
    return shell(
        gid, c,
        f'<g transform="translate(200 200)">'
        f'<circle r="122" fill="#0a0c12" stroke="#d6a84f" stroke-opacity="0.5" stroke-width="3"/>'
        f'<circle r="104" fill="none" stroke="#6b3410" stroke-width="7"/>{segs}'
        f'<circle r="46" fill="#0a0c12" stroke="#d6a84f" stroke-opacity="0.6" stroke-width="3"/>'
        f'<circle r="14" fill="#d6a84f" fill-opacity="0.85"/>'
        f'<g transform="translate(0 -132)"><circle r="11" fill="#10b981"/>'
        f'<text y="4" text-anchor="middle" font-family="monospace" font-size="12" '
        f'font-weight="bold" fill="#04140e">0</text></g></g>',
    )


def blackjack(c: str, gid: str) -> str:
    return shell(
        gid, c,
        f'<g transform="translate(200 208)">'
        f'<g transform="translate(-52 -14) rotate(-13)">'
        f'<rect x="-62" y="-86" width="124" height="172" rx="13" fill="#0d1018" stroke="#2a3242" stroke-width="2"/>'
        f'<rect x="-52" y="-76" width="104" height="152" rx="9" fill="#151925"/></g>'
        f'<g transform="translate(34 10) rotate(9)">'
        f'<rect x="-62" y="-86" width="124" height="172" rx="13" fill="#f4f6fa" stroke="#c8cdd8" stroke-width="2"/>'
        f'<text x="-44" y="-48" font-family="Georgia, serif" font-size="34" font-weight="bold" fill="#c0392b">A</text>'
        f'<text x="44" y="62" text-anchor="end" font-family="Georgia, serif" font-size="34" font-weight="bold" '
        f'fill="#c0392b" transform="rotate(180 44 62)">A</text>'
        f'<path d="M0 -12 C-16 -30 -30 -20 -30 -8 C-30 6 -12 12 0 26 C12 12 30 6 30 -8 C30 -20 16 -30 0 -12 Z" fill="#c0392b"/>'
        f'</g>'
        f'<g transform="translate(-70 54) rotate(-13)">'
        f'<rect x="-52" y="-76" width="104" height="152" rx="9" fill="#151925"/>'
        f'<text x="-34" y="-40" font-family="Georgia, serif" font-size="30" font-weight="bold" fill="{c}">10</text>'
        f'</g></g>',
    )


def crash(c: str, gid: str) -> str:
    grid = "".join(
        f'<line x1="34" y1="{y}" x2="366" y2="{y}" stroke="#ffffff" stroke-opacity="0.05" stroke-width="1"/>'
        for y in (80, 140, 200, 260)
    )
    return shell(
        gid, c,
        f'<path d="M34 330 L96 300 L146 244 L196 178 L246 128 L306 62 L366 30" fill="none" stroke="{c}" '
        f'stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<path d="M34 330 L96 300 L146 244 L196 178 L246 128 L306 62 L366 30 L366 366 L34 366 Z" fill="{c}" fill-opacity="0.14"/>'
        f'<g transform="translate(366 30)"><circle r="17" fill="{c}"/>'
        f'<circle r="17" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="2"/>'
        f'<path d="M-5 -8 L9 0 L-5 8 Z" fill="#0b0d14"/></g>{grid}',
    )


def mines(c: str, gid: str) -> str:
    gems = {0, 3, 7, 11, 12, 18, 21, 24}
    bombs = {5, 14, 22}
    cells = ""
    i = 0
    for row in range(-2, 3):
        for col in range(-2, 3):
            x, y = col * 64, row * 64
            inner = ""
            if i in gems:
                inner = (
                    f'<path d="M0 -17 L15 -5 L9 15 L-9 15 L-15 -5 Z" fill="{c}" fill-opacity="0.9"/>'
                    f'<path d="M0 -17 L0 15" stroke="#fff" stroke-opacity="0.35"/>'
                )
            elif i in bombs:
                inner = '<circle r="13" fill="#f43f5e" fill-opacity="0.9"/><circle r="4" fill="#0b0d14"/>'
            cells += (
                f'<g transform="translate({x} {y})">'
                f'<rect x="-27" y="-27" width="54" height="54" rx="11" fill="#0d1018" stroke="#2a3242" stroke-width="1.5"/>'
                f'{inner}</g>'
            )
            i += 1
    return shell(gid, c, f'<g transform="translate(200 205)">{cells}</g>')


def plinko(c: str, gid: str) -> str:
    pegs = ""
    for row in range(9):
        for i in range(row + 3):
            x = (i - (row + 2) / 2) * 34
            y = row * 36
            pegs += f'<circle cx="{x:.1f}" cy="{y}" r="4.5" fill="{c}" fill-opacity="{0.35 + row * 0.06:.2f}"/>'
    cols = ["#f43f5e", "#f59e0b", "#d6a84f", "#10b981", "#22d3ee", "#10b981", "#d6a84f", "#f59e0b", "#f43f5e"]
    slots = "".join(
        f'<rect x="{i * 34 - 15}" y="0" width="30" height="26" rx="6" fill="{cols[i + 4]}" fill-opacity="0.85"/>'
        for i in range(-4, 5)
    )
    return shell(
        gid, c,
        f'<g transform="translate(200 60)">{pegs}<circle cx="17" cy="122" r="10" fill="#f0c674"/>'
        f'<g transform="translate(0 316)">{slots}</g></g>',
    )


def limbo(c: str, gid: str) -> str:
    return shell(
        gid, c,
        f'<g transform="translate(200 210)">'
        f'<rect x="-150" y="96" width="300" height="12" rx="6" fill="#2a3242"/>'
        f'<g transform="translate(-58 -6)">'
        f'<path d="M0 60 C0 60 -14 8 0 -34 C14 8 0 60 0 60 Z" fill="{c}" fill-opacity="0.9"/>'
        f'<path d="M0 46 C-8 12 -8 -8 0 -30 C8 -8 8 12 0 46 Z" fill="#fff" fill-opacity="0.32"/>'
        f'<circle cx="0" cy="-34" r="9" fill="#f0c674"/>'
        f'<path d="M-16 62 L16 62 L11 78 L-11 78 Z" fill="#2a3242"/>'
        f'<path d="M-11 78 L-19 100 M11 78 L19 100 M0 78 L0 104" stroke="#f59e0b" stroke-width="5" '
        f'stroke-linecap="round" stroke-opacity="0.85"/></g>'
        f'<text x="86" y="22" font-family="monospace" font-size="46" font-weight="bold" fill="{c}">x</text>'
        f'<text x="86" y="80" font-family="monospace" font-size="42" font-weight="bold" fill="#f0c674">99</text></g>',
    )


def keno(c: str, gid: str) -> str:
    picked_idx = {1, 4, 7}
    balls = ""
    for i in range(10):
        a = (i / 10) * math.tau - math.pi / 2
        x, y = math.cos(a) * 92, math.sin(a) * 92
        picked = i in picked_idx
        balls += (
            f'<g transform="translate({x:.1f} {y:.1f})">'
            f'<circle r="27" fill="{c if picked else "#151925"}" fill-opacity="{0.95 if picked else 1}" '
            f'stroke="{"#f0c674" if picked else "#2a3242"}" stroke-width="2"/>'
            f'<text y="6" text-anchor="middle" font-family="monospace" font-size="19" font-weight="bold" '
            f'fill="{"#0b0d14" if picked else "#67708a"}">{(i + 1) * 4}</text></g>'
        )
    return shell(
        gid, c,
        f'<g transform="translate(200 200)">'
        f'<circle r="128" fill="#0d1018" stroke="#2a3242" stroke-width="2"/>{balls}'
        f'<circle r="36" fill="#0b0d14" stroke="{c}" stroke-opacity="0.6" stroke-width="2"/>'
        f'<text y="9" text-anchor="middle" font-family="monospace" font-size="26" font-weight="bold" fill="{c}">40</text></g>',
    )


def dice(c: str, gid: str) -> str:
    pips5 = "".join(
        f'<circle cx="{x}" cy="{y}" r="14" fill="#12151d"/>' for x, y in ((-34, -34), (34, -34), (0, 0), (-34, 34), (34, 34))
    )
    return shell(
        gid, c,
        f'<g transform="translate(200 208)">'
        f'<g transform="translate(-44 -20) rotate(-11)">'
        f'<rect x="-72" y="-72" width="144" height="144" rx="26" fill="#f4f6fa"/>{pips5}</g>'
        f'<g transform="translate(58 34) rotate(13)">'
        f'<rect x="-60" y="-60" width="120" height="120" rx="22" fill="{c}"/>'
        f'<circle cx="-28" cy="-28" r="12" fill="#0b0d14"/><circle cx="28" cy="28" r="12" fill="#0b0d14"/></g></g>',
    )


BUILDERS = {
    "slots": slots,
    "roulette": roulette,
    "blackjack": blackjack,
    "crash": crash,
    "mines": mines,
    "plinko": plinko,
    "limbo": limbo,
    "keno": keno,
    "dice": dice,
}


# ── banners ──────────────────────────────────────────────

def banner(gid: str, c1: str, c2: str, body: str) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 420" width="1200" height="420" preserveAspectRatio="xMidYMid slice" role="img">
  <defs>
    <linearGradient id="b{gid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/>
    </linearGradient>
    <radialGradient id="bg{gid}" cx="78%" cy="30%" r="70%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="420" fill="#0b0d14"/>
  <rect width="1200" height="420" fill="url(#b{gid})" opacity="0.55"/>
  <rect width="1200" height="420" fill="url(#bg{gid})"/>
  {body}
</svg>"""


def main() -> None:
    for slug, build in BUILDERS.items():
        write(f"games/{slug}.svg", build(THEME[slug], slug))

    # generic fallback for any game without dedicated art
    write(
        "games/default.svg",
        shell(
            "def", "#8b5cf6",
            '<g transform="translate(200 200)">'
            '<rect x="-96" y="-72" width="192" height="144" rx="20" fill="#0d1018" stroke="#8b5cf6" '
            'stroke-opacity="0.45" stroke-width="2"/>'
            '<circle cx="-42" cy="-22" r="13" fill="#8b5cf6" fill-opacity="0.8"/>'
            '<circle cx="0" cy="0" r="13" fill="#d6a84f" fill-opacity="0.9"/>'
            '<circle cx="42" cy="22" r="13" fill="#8b5cf6" fill-opacity="0.8"/>'
            '<circle cx="42" cy="-22" r="13" fill="#22d3ee" fill-opacity="0.7"/>'
            '<circle cx="-42" cy="22" r="13" fill="#22d3ee" fill-opacity="0.7"/></g>',
        ),
    )

    bars = "".join(
        f'<rect x="{640 + i * 78}" y="{300 - h}" width="52" height="{h}" rx="12" fill="#d6a84f" '
        f'fill-opacity="{0.16 + i * 0.05:.2f}"/>'
        for i, h in enumerate((130, 190, 250, 300, 250, 190, 130))
    )
    write(
        "banners/welcome.svg",
        banner(
            "w", "#2a1a4a", "#0b0d14",
            f'<g opacity="0.9">{bars}'
            '<circle cx="900" cy="120" r="70" fill="none" stroke="#d6a84f" stroke-opacity="0.35" stroke-width="3"/>'
            '<circle cx="900" cy="120" r="46" fill="none" stroke="#8b5cf6" stroke-opacity="0.35" stroke-width="2"/>'
            '<circle cx="900" cy="120" r="24" fill="#d6a84f" fill-opacity="0.5"/></g>',
        ),
    )

    write(
        "banners/crash.svg",
        banner(
            "c", "#3a1020", "#0b0d14",
            '<path d="M700 340 L820 300 L900 230 L980 160 L1080 90 L1180 50" fill="none" stroke="#f43f5e" '
            'stroke-width="8" stroke-linecap="round"/>'
            '<path d="M700 340 L820 300 L900 230 L980 160 L1080 90 L1180 50 L1180 420 L700 420 Z" '
            'fill="#f43f5e" fill-opacity="0.14"/>'
            '<circle cx="980" cy="160" r="14" fill="#f43f5e"/>',
        ),
    )

    candles = "".join(
        f'<circle cx="{730 + i * 68}" cy="{112 - (i % 2) * 8}" r="9" fill="#f0c674" fill-opacity="0.75"/>'
        for i in range(5)
    )
    write(
        "banners/vip.svg",
        banner(
            "v", "#3a2c0e", "#0b0d14",
            f'<g opacity="0.85">'
            '<path d="M700 120 L760 190 L840 120 L900 210 L1000 120 L1000 280 L700 280 Z" fill="#d6a84f" '
            'fill-opacity="0.22" stroke="#f0c674" stroke-opacity="0.5" stroke-width="2"/>'
            f'{candles}</g>',
        ),
    )

    live_bg = "".join(
        f'<circle cx="{790 + i * 60}" cy="230" r="20" fill="#0b0d14" fill-opacity="0.65" '
        f'stroke="#ef4444" stroke-opacity="0.5" stroke-width="2"/>'
        for i in range(5)
    )
    write(
        "banners/live.svg",
        banner(
            "l", "#2a0e14", "#0b0d14",
            f'<g opacity="0.85">'
            '<rect x="720" y="130" width="330" height="190" rx="18" fill="#7f1d1d" fill-opacity="0.28" '
            'stroke="#f0c674" stroke-opacity="0.35" stroke-width="2"/>'
            f'{live_bg}'
            '<rect x="1030" y="112" width="60" height="60" rx="12" fill="#f4f6fa" fill-opacity="0.9"/>'
            '<rect x="1052" y="112" width="16" height="60" fill="#c0392b" fill-opacity="0.9"/>'
            '<rect x="1030" y="134" width="60" height="16" fill="#c0392b" fill-opacity="0.9"/></g>',
        ),
    )

    mark = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img">
  <defs>
    <linearGradient id="au" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f0c674"/><stop offset="0.55" stop-color="#d6a84f"/><stop offset="1" stop-color="#8a6a28"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="18" fill="#0b0d14"/>
  <path d="M32 10 L50 50 L40 50 L32 31 L24 50 L14 50 Z" fill="url(#au)"/>
  <circle cx="32" cy="44" r="4" fill="#0b0d14"/>
  <circle cx="32" cy="44" r="8" fill="none" stroke="url(#au)" stroke-width="2" stroke-opacity="0.55"/>
</svg>"""
    write("favicon.svg", mark)
    write("logo.svg", mark)

    write(
        "providers/aurora-originals.svg",
        """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" width="120" height="40" role="img">
  <defs>
    <linearGradient id="po" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#f0c674"/><stop offset="1" stop-color="#d6a84f"/>
    </linearGradient>
  </defs>
  <path d="M20 8 L31 32 L26 32 L20 18 L14 32 L9 32 Z" fill="url(#po)"/>
  <circle cx="20" cy="27" r="2.4" fill="#0b0d14"/>
  <text x="40" y="26" font-family="Inter, sans-serif" font-size="15" font-weight="800" fill="#f4f6fa">Aurora</text>
  <text x="40" y="36" font-family="Inter, sans-serif" font-size="8" font-weight="700" fill="#67708a" letter-spacing="1.6">ORIGINALS</text>
</svg>""",
    )

    write(
        "og.svg",
        """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" role="img">
  <defs>
    <linearGradient id="og" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#12162a"/><stop offset="1" stop-color="#080a0f"/>
    </linearGradient>
    <radialGradient id="ogr" cx="70%" cy="30%" r="65%">
      <stop offset="0" stop-color="#8b5cf6" stop-opacity="0.35"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#og)"/>
  <rect width="1200" height="630" fill="url(#ogr)"/>
  <g transform="translate(96 250)">
    <path d="M0 0 L34 76 L20 76 L0 30 L-20 76 L-34 76 Z" fill="#d6a84f"/>
    <circle cx="0" cy="64" r="5" fill="#080a0f"/>
  </g>
  <text x="150" y="322" font-family="Sora, Inter, sans-serif" font-size="64" font-weight="800" fill="#f4f6fa">Aurora</text>
  <text x="96" y="396" font-family="Inter, sans-serif" font-size="26" fill="#9aa3b8">Provably fair casino platform</text>
</svg>""",
    )

    print("art written to", OUT)


if __name__ == "__main__":
    main()
