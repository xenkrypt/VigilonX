# VigilonX – SRE Control Plane for AutoModerator

VigilonX is an advanced Reddit Devvit Application designed to serve as a professional Site Reliability Engineering (SRE) Control Plane for AutoModerator. By unifying the Devvit Mod Tool capabilities with a rich Custom Post Webview interface, VigilonX brings software engineering best practices—such as version control, visual rule diffing, team proposals, health scoring, concurrent edit leasing, incident response, and safe testing—directly into the subreddit moderation ecosystem.

---

## 🚀 Key Features

*   **Version Control & Snapshots ("Git for AutoMod"):** Keep a tiered history of `auto`, `manual`, and `milestone` snapshots. Instantly compare changes with a rule-level visual diff engine.
*   **Intelligent Validation & Guardrails:** Real-time client-side YAML parsing and linting (debounced at 500ms), plus a "Deep Validate" engine checking for logical flaws and specific AutoModerator quirks.
*   **Operational Governance Modes:**
    *   **Safe Mode:** Read-only mode with deploy/rollback actions locked.
    *   **Standard Mode:** Live deployments enabled after all validation checks pass.
    *   **Power Mode:** Re-activates advanced workflows (e.g., cross-subreddit sync and partial rollbacks).
*   **Concurrently Edit Leasing:** Avoid merge conflicts with Redis-backed 15-minute edit leases indicating who is currently drafting edits.
*   **Emergency Incident Response ("The RED Brake"):** Trigger an instantaneous fallback deployment to the last stable snapshot and freeze all further edits globally in one click.
*   **Interactive Simulation & Sandbox:** Test draft rules against simulated Reddit items (Link Spam, Keyword Filters, Age/Karma gating) with honest confidence scoring.
*   **Curated Pattern Wizard:** Pick from 8 verified community templates (like Age Gates or Spam Filters) to auto-inject flawless YAML configurations.
*   **Algorithmic Health Grading:** Tracks config quality (A to F) across 6 different vectors and displays history through SVG sparklines.
*   **Training Missions:** 3 localized interactive scenarios (Beginner, Intermediate, Advanced) teaching how to securely edit and secure AutoMod code.

---

## 🛠️ Architecture & Directory Layout

```text
VigilonX/
├── src/
│   ├── main.tsx          # Backend: Devvit Blocks & Redis API Gateway
│   └── message.ts        # Protocols: Discriminated unions for Webview communication
├── webroot/
│   ├── page.html          # Webview DOM & Modals
│   ├── script.js          # App Controller / Frontend State Manager
│   ├── style.css          # Design System & Theming (True Dark/Light)
│   ├── yaml-parser.js     # Bespoke AutoMod YAML AST parser
│   ├── validation.js      # Syntactic validation & parser interfaces
│   ├── guardrails.js      # Semantic linter / best practices engine
│   ├── rule-tester.js     # Offline AutoMod simulator engine
│   ├── diff-engine.js     # Rule-level YAML comparative engine
│   ├── health-score.js    # 6-factor grading and SVG chart generator
│   ├── pattern-library.js # Community rule templates and generator UI
│   └── training.js        # Educational mission state tracker
├── devvit.yaml            # Devvit project manifest
├── package.json           # npm dependencies & configurations
├── tsconfig.json          # TS compiler rules
└── PROJECT_DESCRIPTION.md # Exhaustive technical architecture reference
```

---

## ⚡ Development & Playtesting

### 1. Installation
Install project dependencies:
```bash
npm install
```

### 2. Run Local Type Checks
Ensure TypeScript compiles with zero errors before packaging:
```bash
npm run type-check
```
*Or directly via TypeScript compiler:*
```bash
npx tsc --noEmit
```

### 3. Launch Local Playtest
Start the Devvit simulator to test the application on a target subreddit:
```bash
npx devvit playtest r/YourSubreddit
```

### 4. Deploy to Reddit
Upload and activate the application on Reddit's production Devvit infrastructure:
```bash
npx devvit upload
```

---

## 🔒 The Prime Directive
**VigilonX** is built with a non-negotiable core guarantee: *It will never lose, silently corrupt, or accidentally overwrite your active AutoModerator configuration.*
