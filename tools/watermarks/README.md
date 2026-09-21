# Sport watermark renderer

Source for `public/watermarks/*.svg` — the nine 3D sport marks used as the
card-art fallback (and as the `rugby_int` league mark). The SVGs are ~150 KB of
projected path data; regenerate them here rather than hand-editing.

- `g3d.py` — the renderer. A spheroid (`Body`) in a body frame, rotated by
  yaw/pitch/tilt and orthographically projected. Surface regions and lines are
  built in (latitude, longitude) with shapely, clipped to the visible set, then
  projected. Text is flattened from a TTF with fontTools and wrapped onto the
  surface through the tangent frame. `Scene.shade()` adds the form shadow,
  rim darkening, specular and rim light as gradients clipped to the silhouette;
  `Scene.leather()` a turbulence grain. `fill3d`/`stroke3d` handle true 3D
  geometry (the football's truncated icosahedron, the baseball seam).
- `marks.py` — one function per mark. Colour is greyscale only: the files are
  served WITHOUT the mono filter so one render works on both card grounds (see
  `SPORT_FALLBACK_SPEC` in `src/lib/watermarks.ts`; `test-watermarks` asserts
  it). Text is the SPORTHOUSE wordmark plus the sport line and size fine print.
- `preview.py` — faithful contact sheet: rasterises with resvg and composites at
  card opacity on both card colours (`#161617` / `#fbfafc`).

## Run

```bash
python3 -m venv .venv && .venv/bin/pip install pillow resvg_py fonttools shapely numpy
.venv/bin/python marks.py               # all nine → public/watermarks/
.venv/bin/python marks.py rugby puck    # a subset
WM_OUT=/tmp/out .venv/bin/python marks.py   # elsewhere, to compare first
.venv/bin/python preview.py sheet.png 0.40 public/watermarks/*.svg
```

Fonts are read from macOS system paths (`Arial Black`, `Arial Bold`); point
the constants at the top of `g3d.py` elsewhere on another OS. Pinned versions
that are known to work: fonttools 4.60, numpy 2.0, pillow 11.3, resvg_py 0.3,
shapely 2.0.
