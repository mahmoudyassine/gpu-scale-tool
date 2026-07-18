# Changelog

## Studio 4.6 — 2026-07-18
- Icons inside the graphics: site/shield/globe glyphs on topology frames, sync
  icon on replication links, per-frame power (kW) chips with bolt icon.
- Chart annotations: axis captions on both charts, memory-limit value on the
  guide line, aggregate-throughput operating point (Σ marker), tok/s value on
  the context marker; topology note now shows per-GPU utilization.
- Footer states the open-source status and links the repo
  (mahmoudyassine/gpu-scale-tool).

## Studio 4.5 — 2026-07-18
- Section icon system: 16 hand-drawn stroke icons (currentColor, both themes)
  across input stations, readout panels and KPI cards.
- Open-sourced: MIT license, .gitignore, .nojekyll, README header + GitHub
  Pages publishing guide for github.com/mahmoudyassine/gpu-scale-tool.

## Studio 4.4 — 2026-07-18
- Dark-mode correctness: page declares `color-scheme` (meta + CSS), paints the
  `<html>` element, ships scheme-aware `theme-color` metas, and follows the OS
  appearance on load (manual toggle overrides; live-follows OS changes until
  toggled). Fixes the mixed light-panels-on-dark-canvas rendering seen in
  dark-mode webviews and file previews.

## Studio 4.3 — 2026-07-18
- Unified palette: exactly one teal (`#0F766E`/`#2DD4BF`) and one indigo
  (`#4F63C2`/`#8B9CE8`) plus semantic amber/red and slate neutrals — legacy
  teal variants removed from styles, charts, topology, badges, XLS and both
  logo suites; robot pupils now amber to match teeth.
- Footer: GitHub link (mahmoudyassine).

## Studio 4.2 — 2026-07-18
- New primary logo: robot-head mark derived from a GPU card illustration —
  twin-fan eyes, glowing hubs, PCIe gold-finger grin with key-notch gap.
  Favicons, rasters and the theme-aware header mark updated; chip mark kept
  as an alternate.

## Library v23 · Studio 4.1 — 2026-07-18
- Restructured into a maintainable site pack: markup / styles / logic / data
  fully separated; data lives in `data/*.js` (one entry per line).
- New brand identity: chip-and-rising-bars mark, vector-outline wordmark,
  full favicon set; theme-aware logo in the header.
- Library +22 models → 94: Kimi K3 2.8T-A50B; Arabic/GCC set (Jais-2 70B/8B,
  Jais-adapted-70B, Fanar-2-27B, ALLaM-34B, Falcon-H1-Arabic-34B,
  Falcon-Arabic-7B, SILMA-9B); Cohere set (Command A+ 218B MoE, A Reasoning,
  R+ 104B, R 32B, R7B, R7B Arabic, Aya Expanse 32B/8B); Mistral set
  (Saba 24B, Magistral Small 1.2, Large 2 123B, Ministral 8B, Small 4).
- `tools/build_single_file.py` regenerates the portable one-file build.

## Studio 4.0 — 2026-07-18
- Rebranded to GPUscale.net; N+N+DR active/active resilience mode (4N);
  rebuilt worker/GPU-utilization topology infographic; Safari SVG
  height-collapse fix (explicit aspect-ratio); cleaner headings; footer
  formulas removed.

## Studio 3.0 and earlier — 2026-07-18
- Worker × GPUs-per-worker hardware model with N/N+1/N+N/DR topologies,
  PDF + live-formula XLS export, mobile pass, light/dark themes,
  engine v22 parity with the Excel workbook.
