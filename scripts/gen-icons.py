#!/usr/bin/env python3
"""Generate Dhara PWA icons from dhara-logo.svg — light glyph on dark #0B0D10."""
import cairosvg, re, os

SRC = "/home/z/my-project/upload/dhara-logo.svg"
OUT = "/home/z/my-project/public"
BG = "#0B0D10"
FG = "#E8EAED"

svg = open(SRC).read()
# strip the C2PA metadata block (keeps icon files tiny)
svg = re.sub(r"<metadata>.*?</metadata>", "", svg, flags=re.S)
# force light glyph, drop the media query
svg = re.sub(r"\.m \{ fill: #111111; \}", f".m {{ fill: {FG}; }}", svg)
svg = svg.replace('@media (prefers-color-scheme: dark) { .m { fill: #ffffff; } }', "")

def make(size: int, pad_pct: float, rounded: bool) -> str:
    pad = int(380 * pad_pct)
    inner = svg.replace('viewBox="0 0 380 380"', f'viewBox="{-pad} {-pad} {380 + 2*pad} {380 + 2*pad}"', 1)
    rx = ' rx="88"' if rounded else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {380+2*pad} {380+2*pad}" width="{380+2*pad}" height="{380+2*pad}">'
            f'<rect width="{380+2*pad}" height="{380+2*pad}" fill="{BG}"{rx}/>'
            f'<g transform="scale(1)">{inner}</g></svg>')

jobs = [
    ("icon-192.png", 192, 0.14, True),
    ("icon-512.png", 512, 0.14, True),
    ("icon-maskable-512.png", 512, 0.26, False),   # extra safe zone for maskable
    ("apple-touch-icon.png", 180, 0.14, True),
]
for name, size, pad, rounded in jobs:
    full = make(size, pad, rounded)
    cairosvg.svg2png(bytestring=full.encode(), write_to=f"{OUT}/{name}",
                     output_width=size, output_height=size, background_color=BG)
    print(name, os.path.getsize(f"{OUT}/{name}"), "bytes")

# favicon.svg — glyph follows OS color-scheme, no background
fav = open(SRC).read()
fav = re.sub(r"<metadata>.*?</metadata>", "", fav, flags=re.S)
fav = fav.replace('width="512" height="512"', 'width="64" height="64"')
open(f"{OUT}/favicon.svg", "w").write(fav)
print("favicon.svg written")
