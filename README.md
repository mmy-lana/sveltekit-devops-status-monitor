# Asset Management & DevOps Server Status Monitor

Enterprise-grade infrastructure monitor and server asset manager styled after the AWS CloudWatch console. Built with SvelteKit, Svelte 5 runes, Tailwind CSS v4, and Dexie.js for client-side offline persistence.

- Live Application: https://sveltekit-devops-status-monitor.vercel.app
- GitHub Repository: https://github.com/mmy-lana/sveltekit-devops-status-monitor

---

## Overview

A client-side DevOps telemetry simulator and infrastructure dashboard. It replicates enterprise monitoring environments with zero server dependencies, executing all time-series queries, alarm rules, incident lifecycles, and synthetic metric drift locally inside IndexedDB.

### Key Capabilities

- Real-Time Telemetry Simulation: Autonomous background collector simulating CPU, memory, disk, network throughput, and latency with bounded Ornstein-Uhlenbeck mean-reverting drift.
- Dual-Axis Vector Metric Charts: Responsive SVG charting with touch scrubbing, dynamic axis clamping, custom time ranges (1h to 7d), and threshold overlay guides.
- CloudWatch Alarm Engine: Pure rule evaluation engine supporting consecutive breach latching, streak tracking, manual acknowledgements, and fleet-wide vs. instance-scoped isolation.
- Incident Lifecycle Command: Append-only incident register tracking MTTR (Mean Time to Resolve), severity levels (SEV-1 through SEV-4), and chronological timeline transitions.
- ReDoS-Hardened Log Streamer: Interactive log console supporting regex queries with AST-level backtracking guards, character limits, and automatic fallback to linear substring search.
- Offline-First Architecture: High-throughput compound indexing (`[serverId+timestamp]`) via Dexie.js with automated retention cleanup.
- Mobile-First Interface: Adaptive layouts verified across 360px, 390px, 430px, 768px, 1280px, and 1600px viewports with zero horizontal overflow and minimum 44x44px touch targets.

---

## Tech Stack

- Framework: SvelteKit (SPA mode with `ssr = false`)
- Reactivity: Svelte 5 Runes (`$state`, `$derived.by`, `$effect`, `.svelte.ts`)
- Styling: Tailwind CSS v4 (CSS-native `@theme` tokens)
- Local Database: Dexie.js v4 (IndexedDB)
- Language: TypeScript (Strict mode)
- Verification & Test: Playwright (Headless Chromium verification harness)
- Package Manager: pnpm

---

## Project Structure

```
src/
├── app.css                               # Tailwind v4 theme tokens and global base styles
├── app.d.ts                              # Application type declarations
├── app.html                              # Root HTML shell
├── lib/
│   ├── components/
│   │   ├── primitives/                   # Design system atoms (Badge, Button, Card, Input, etc.)
│   │   ├── compound/                     # Molecule components (MetricChart, Sparkline, LogConsole, etc.)
│   │   └── domain/                       # Feature views (ServerListTable, AlarmListManager, AssetFormModal, etc.)
│   ├── db/
│   │   └── index.ts                      # Dexie schema, compound indexes, seed profiles, and queries
│   ├── engine/
│   │   └── alarmEvaluator.ts             # Pure alarm rule evaluation, breach streaks, and MTTR math
│   ├── stores/
│   │   ├── monitorStore.svelte.ts        # Primary Svelte 5 state machine and collector loop
│   │   └── filterStore.svelte.ts         # Table query state, multi-criteria filtering, and sorting
│   ├── types/
│   │   └── monitor.ts                    # Pure TypeScript contracts for assets, metrics, alarms, incidents
│   └── utils/
│       ├── alarmUtils.ts                 # Operator comparison and threshold formatters
│       ├── formatting.ts                 # Bandwidth, duration, timestamp, and percentage formatters
│       ├── id.ts                         # Universal collision-resistant identifier generator
│       └── statistics.ts                 # Pure math: moving average, P95, sample standard deviation
└── routes/
    ├── +layout.ts                        # Client-side SPA lock (export const ssr = false)
    ├── +layout.svelte                    # Navigation header, live health pill, and breadcrumb bar
    ├── +page.svelte                      # Fleet Overview dashboard
    ├── alarms/
    │   └── +page.svelte                  # Fleet-wide alarm manager and threshold editor
    ├── incidents/
    │   └── +page.svelte                  # Incident command register and detail drawer
    └── servers/
        └── [id]/
            └── +page.svelte              # Instance deep dive: dual-axis charts, live tail, specs
```

---

## Getting Started

### Prerequisites

- Node.js (version 20 or higher recommended)
- pnpm

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/mmy-lana/sveltekit-devops-status-monitor.git
cd sveltekit-devops-status-monitor
pnpm install
```

### Development Server

Start Vite in local development mode:

```bash
pnpm dev
```

Navigate to `http://localhost:5173` in your browser.

### Type-Checking & Verification

Run SvelteKit type synchronization and static checks:

```bash
pnpm check
```

Run the automated headless Chromium verification harness (covers 530+ structural, mathematical, and accessibility assertions):

```bash
pnpm verify
```

To run verification against a live local dev server on port 5173:

```bash
VERIFY_BASE_URL=http://localhost:5173 pnpm verify
```

### Production Build

Create an optimized static production bundle:

```bash
pnpm build
```

Preview the production build locally:

```bash
pnpm preview
```

---

## Design System & Architecture Tokens

The UI follows the dark slate aesthetic of the AWS CloudWatch enterprise console:

- Base Canvas: `--color-slate-base: #0b0f17`
- Panel Surface: `--color-slate-surface: #111827`
- Container Cards: `--color-slate-card: #161f30`
- Borders: `--color-slate-border: #1e293b`
- Brand Accent: `--color-cw-accent: #ec7211`
- Metric Blue: `--color-cw-blue: #38bdf8`
- Warning Amber: `--color-cw-amber: #f59e0b`
- Healthy Emerald: `--color-cw-emerald: #10b981`
- Critical Rose: `--color-cw-rose: #ef4444`

---

## License

This project is licensed under the MIT License.
