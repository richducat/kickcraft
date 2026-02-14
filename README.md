# KickCraft

A soccer game prototype for Everett.

## What’s in here

- `web/` — playable web prototypes (no build step)
  - `web/kickcraft-11v11/` — the current 11v11 “pseudo‑3D” canvas prototype
  - `web/fc-street/` — FC Street-style 3D prototype (Three.js) + an endless runner mode (WIP)

## Run locally

These are static files. Easiest way:

```bash
cd web/fc-street
python3 -m http.server 5173
```

Then open: http://localhost:5173

(If you don’t have python3, use any static server.)
