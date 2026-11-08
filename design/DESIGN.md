---
name: Key Pulse Telemetry
colors:
  surface: '#131316'
  surface-dim: '#131316'
  surface-bright: '#39393c'
  surface-container-lowest: '#0e0e11'
  surface-container-low: '#1b1b1e'
  surface-container: '#1f1f22'
  surface-container-high: '#2a2a2d'
  surface-container-highest: '#353438'
  on-surface: '#e4e1e6'
  on-surface-variant: '#e5bdc0'
  inverse-surface: '#e4e1e6'
  inverse-on-surface: '#303033'
  outline: '#ac888b'
  outline-variant: '#5c3f42'
  surface-tint: '#ffb2ba'
  primary: '#ffb2ba'
  on-primary: '#670020'
  primary-container: '#ff4f73'
  on-primary-container: '#5a001b'
  inverse-primary: '#bd0042'
  secondary: '#ebffe6'
  on-secondary: '#003911'
  secondary-container: '#00fe66'
  on-secondary-container: '#007128'
  tertiary: '#adc6ff'
  on-tertiary: '#002e6a'
  tertiary-container: '#4d8eff'
  on-tertiary-container: '#00285d'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffd9dc'
  primary-fixed-dim: '#ffb2ba'
  on-primary-fixed: '#400011'
  on-primary-fixed-variant: '#910030'
  secondary-fixed: '#6bff83'
  secondary-fixed-dim: '#00e55b'
  on-secondary-fixed: '#002107'
  on-secondary-fixed-variant: '#00531b'
  tertiary-fixed: '#d8e2ff'
  tertiary-fixed-dim: '#adc6ff'
  on-tertiary-fixed: '#001a42'
  on-tertiary-fixed-variant: '#004395'
  background: '#131316'
  on-background: '#e4e1e6'
  surface-variant: '#353438'
typography:
  headline-xl:
    fontFamily: Syne
    fontSize: 40px
    fontWeight: '800'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Syne
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Syne
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: 0em
  headline-sm:
    fontFamily: Syne
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: 0em
  body-lg:
    fontFamily: Space Mono
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-md:
    fontFamily: Space Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Space Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Space Mono
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Space Mono
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.08em
  code-telemetry:
    fontFamily: Space Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: -0.02em
spacing:
  gutter: 12px
  gutter-compact: 8px
  margin: 16px
  margin-dock: 8px
  space-xs: 4px
  space-sm: 8px
  space-md: 12px
  space-lg: 16px
  space-xl: 24px
---

## Brand & Style

This design system establishes a high-precision, low-latency telemetry console environment. Built for mission-critical engineering workflows and real-time metric tracking, the visual identity merges cyber-telemetry aesthetics with brutalist geometric structure. 

The emotional tone is razor-sharp, immediate, and authoritative:
- **Zero Ambiguity:** Strict zero-radius corners and structural hairline borders produce absolute grid discipline.
- **Urgent Precision:** Real-time diagnostics, health statuses, and critical thresholds leverage the primary crimson heartbeat accent to instantly signal attention without decorative distraction.
- **Instrument-Grade Technicality:** The aesthetic pairs expressive avant-garde structural display headings with monospace typographic precision, transforming dense desktop interfaces into high-density operational consoles.

## Colors

The palette is engineered specifically for deep dark desktop interfaces with layered depth, high visual contrast, and high-frequency real-time signal feedback.

### Palette Architecture
- **Heartbeat Crimson (`#FF3366` - Primary):** Serves as the primary operational signifier, alert beacon, critical anomaly pulse, and high-priority toggle indicator.
- **Neon Matrix Green (`#00FF66` - Secondary):** Dedicated to operational telemetry health, nominal states, online nodes, and valid execution logs.
- **Electric Cyan/Blue (`#3B82F6` - Tertiary):** Drives active selection states, link vectors, informational readouts, and primary focal controls.
- **Console Surface Layers (Neutrals):**
  - **Void Base (`#0F0F12`):** Primary window canvas and outer backdrop.
  - **Surface Level 1 (`#121214`):** Fixed panels, persistent side navigation, and modular docks.
  - **Surface Level 2 (`#18181C`):** Telemetry cards, code panes, and metric modules.
  - **Surface Level 3 (`#1C1C1E`):** Active module headers, dropdown popovers, and elevated focus layers.
  - **Wireframe Border (`#282830`):** Strict structural container divider and grid delimitation.

### Contrast & State Directives
Text defaults to `#EDEDEF` for high legibility, with muted telemetry timestamps downscaled to `#8A8A93`. Hover interactions shift background surfaces strictly one step up the neutral tier while activating hairline borders via the accent palette.

## Typography

The typographic hierarchy creates a deliberate tension between the avant-garde geometric display weights of Syne and the calculated, tabular accuracy of Space Mono.

- **Syne** is reserved for top-level operational titles, system monitors, workspace section headers, and high-impact numerical readouts where character and architectural structure differentiate the console.
- **Space Mono** governs all data fields, telemetry rows, labels, inspector panels, interactive tags, and body copy. All metrics and timestamps render in full tabular alignment to eliminate jitter during real-time data streaming.
- **Casing Rules:** Structural status labels (`label-sm`, `label-md`) must always be rendered in full uppercase with expanded letter-spacing to reinforce instrument precision.

## Layout & Spacing

Designed primarily for desktop telemetry stations, the spatial model implements a dense, modular grid driven by fixed multi-pane docks and high-efficiency flex tracks.

### Grid & Paneling
- **Base Grid:** 12-column variable dock layout with fixed minimum column constraints (280px minimum width for auxiliary sidebars, 480px for main telemetry streams).
- **Rhythm Multiplier:** A hard 4px base step coordinates all padding and spatial intervals.
- **Gutter Mechanics:** Standard desktop gutter is set to `12px` to maximize screen real estate, tightening to `8px` within micro-telemetry cards and parameter inspector sidebars.

### Desktop Spatial Breakpoints
- **Compact Viewport (1024px - 1279px):** Sidebar collapses to icon rail (`48px`), metrics panels stack into 2-column arrays, outer margin locks to `12px`.
- **Standard Desktop (1280px - 1919px):** 3-pane layout active (Navigator, Primary Stream, Inspector), `16px` outer margin.
- **Ultra-Wide Telemetry (≥ 1920px):** Multi-dock active; 4 to 6 concurrent real-time charts; gutters remain tight (`12px`) to ensure instant spatial scanning without peripheral drift.

## Elevation & Depth

This design system avoids simulated diffuse shadows and skeuomorphic blur gradients, adhering strictly to a tactical **flat-tiered wireframe model**.

### Depth Layers
1. **Canvas (`#0F0F12`):** Base structural canvas; sits at `z-index: 0`.
2. **Dock Surface (`#121214`):** Fixed operational frames bounded by 1px solid `#282830` borders.
3. **Card & Module Surface (`#18181C`):** Interactive data cards and log containers, isolated with `#282830` hairlines.
4. **Active & Floating Overlay (`#1C1C1E`):** Dropdowns, telemetry modals, and context menus. Depth is articulated via a solid 1px accent hairline border (`#3B82F6` or `#FF3366`) complemented by a hard, 0-blur offset shadow (`3px 3px 0px #000000`).

### Optical Borders
Elevation between sibling elements is communicated exclusively through border contrast. Hovering an interactive element transitions the border from `#282830` to `#3B82F6` or `#FF3366`, accompanied by an internal surface step shift to `#1C1C1E`.

## Shapes

The shape system is strictly **sharp (0px roundedness)** across the entire interface. 

- All buttons, modals, input containers, progress tracks, indicators, tabs, and cards feature hard right-angle corners.
- Micro-indicators and status pips use square geometries (`6x6px` or `8x8px` blocks) rather than circular dots to maintain the mechanical, terminal-style character.
- Angled cuts (such as 45-degree corner notches) are permitted solely on high-level status tags via CSS clip-paths to echo cyber-telemetry aesthetics while preserving flat surfaces.

## Components

### Buttons
- **Primary Action (Tertiary Focus):** Background `#3B82F6`, text `#FFFFFF`, 0px border radius, 1px solid `#3B82F6`. Hover triggers background `#2563EB` with an outer 1px hairline ring.
- **Heartbeat Critical Button:** Background `#FF3366`, text `#FFFFFF`, 0px border radius. Used strictly for terminate actions, manual overrides, and alert triggers. Hover: `#E02454`.
- **Secondary Console Button:** Background `#18181C`, text `#EDEDEF`, 1px solid `#282830`. Hover shifts background to `#1C1C1E` and border to `#EDEDEF`.
- **Typography:** `label-md` (uppercase Space Mono), horizontal padding `16px`, height `36px`.

### Chips & Telemetry Status Badges
- **Nominal / Online:** 1px solid `#00FF66`, background `rgba(0, 255, 102, 0.08)`, text `#00FF66`.
- **Pulse Alert / Critical:** 1px solid `#FF3366`, background `rgba(255, 51, 102, 0.12)`, text `#FF3366`.
- **Active State / Trace:** 1px solid `#3B82F6`, background `rgba(59, 130, 246, 0.1)`, text `#3B82F6`.
- Height: `22px`, font: `label-sm`, square edges, optional `4x4px` leading square block.

### Input Fields & Terminal Controls
- Background `#121214`, border 1px solid `#282830`, text `#EDEDEF`, placeholder `#8A8A93`.
- Font: `code-telemetry` (`Space Mono`).
- Focus state: Border instantly snaps to 1px solid `#3B82F6` with zero transition lag. No ambient glow.
- Suffix / Prefix addons use `#18181C` surface blocks with rigid divider borders.

### Cards & Telemetry Containers
- Background `#18181C`, border 1px solid `#282830`, padding `16px`.
- Card Header: Features a separate sub-bar docked with border-bottom 1px solid `#282830`, displaying category title in Syne (`headline-sm`) alongside status metadata chips.

### Checkboxes & Switches
- **Checkbox:** Square box `16x16px`, border 1px solid `#282830`, background `#121214`. Checked state fills box with `#3B82F6` hosting a solid `#FFFFFF` square core (`8x8px`).
- **Telemetry Toggle:** Rectangular rail `36x18px`, border 1px solid `#282830`, background `#121214`. Switch block is an internal square (`12x12px`) shifting from `#8A8A93` (inactive) to `#00FF66` or `#FF3366` (active).

### Data Tables & Log Feeds
- Header rows: `#121214`, border-bottom 2px solid `#282830`, text `label-sm` in `#8A8A93`.
- Cell rows: Alternate subtle row striping (`#121214` to `#18181C`), border-bottom 1px solid `#282830`.
- Hover state: Background switches to `rgba(59, 130, 246, 0.06)` with left border indicator snapping to 2px solid `#3B82F6`.