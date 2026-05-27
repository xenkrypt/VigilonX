# VigilonX – SRE Control Plane for AutoModerator

## 1. Project Overview & Philosophy

VigilonX is an advanced Reddit Devvit Application architected to serve as a professional Site Reliability Engineering (SRE) Control Plane for AutoModerator. Managing complex AutoModerator rules via plain text wiki pages is fraught with risks: typos can cause catastrophic community disruptions, and there is no native support for staging, linting, testing, or peer review. 

By unifying the Devvit Mod Tool capabilities with a rich Custom Post Webview interface, VigilonX brings enterprise-grade software engineering practices—version control, visual rule diffing, team proposals, health scoring, concurrent edit leasing, incident response, and safe testing—directly into the subreddit moderation ecosystem.

**The Prime Directive:** VigilonX is engineered with a non-negotiable core guarantee: *It will never lose, silently corrupt, or accidentally overwrite your active AutoModerator configuration.*

---

## 2. Exhaustive Feature Matrix

### A. Version Control & Snapshot Engine ("Git for Automod")
*   **Tiered Snapshots:** Every configuration state is saved as a snapshot, strictly categorized by `tier`:
    *   **Auto:** Automatically generated before every deployment, rollback, or external sync.
    *   **Manual:** explicitly created by a moderator with a custom note.
    *   **Milestone:** Pinned configurations that represent known-stable states; these are never auto-pruned by retention policies.
*   **Active Tracking:** The currently deployed configuration is dynamically flagged as `ACTIVE`.
*   **Visual Diff Engine:** A built-in rule-by-rule visual diff system that compares any two configurations (Active vs Draft, Snapshot vs Active, etc.) highlighting exact YAML changes and partial merges.
*   **Power Mode Partial Rollback:** In "Power Mode", rolling back allows selecting specific, isolated rule groups to revert rather than the entire configuration file.

### B. Intelligent Draft Editor & Validation
*   **Debounced Fast Linting:** Syntax validation runs on a 500ms debounce loop as you type, providing an inline error count without freezing the main UI thread.
*   **Deep Validate (Guardrails Engine):** On-demand full semantic analysis that parses over 100 rules for structural integrity, type checking, and logical flaws (e.g., mismatched types, broad regexes causing backtracking).
*   **Specific Constraint Enforcement:** The validator explicitly checks AutoMod quirks, such as requiring operator syntax (`< 1 days`) for the `account_age` property, and catching missing `action_reason` fields.
*   **localStorage Crash Recovery:** Edits are silently autosaved to the browser's `localStorage`. Upon app reload or crash, a banner offers a one-click "Recover Unsaved Draft" action.
*   **Edit Session Leasing:** Powered by Redis strings, opening a draft creates a 15-minute lease (pinged every 60 seconds). Other moderators opening the tool see a highly visible "Active Edit Session" warning indicating who is currently editing.

### C. Operational Modes & Strict Governance
*   **Three Operational Modes:**
    *   **Safe Mode (Default):** Read-only environment. All deploy and rollback actions are hard-locked on both frontend and backend.
    *   **Standard Mode:** Live deployments enabled, provided all validation checks pass.
    *   **Power Mode:** Unlocks advanced workflows like Rule-Scope Partial Rollbacks and Cross-Subreddit feature syncs.
*   **Config Freeze:** A master toggle that instantly blocks all `setConfig` operations globally. Displays a persistent red banner across all user interfaces until lifted.
*   **Change Proposals:** Configs can be submitted as formal "Proposals". Includes a state machine transitioning through Draft → Proposed → Approved → Deployed/Rejected. Includes a mandatory Risk Assessment Checklist.
*   **Approval Gates:** Require $N$ number of approvals before a Proposal can be deployed.
*   **Policy Engine:** Enforces deployment prerequisites, such as requiring "Deep Validate" to run, or ensuring at least one Milestone snapshot exists in the history before allowing deployment.

### D. Simulation, Testing & Patterns
*   **Interactive Simulator:** Test active or draft rules against simulated Reddit items across 5 archetypes (Link Spam, Keyword Filters, Age/Karma gating, Domain blocks, Flair enforcement).
*   **Honest Confidence Scoring:** Simulating rules provides a `coverageFlag` (FULL/PARTIAL/NONE) and a calculated Confidence Percentage bar indicating how closely the test parameters match the rule's conditions.
*   **Unsupported Flagging:** Explicit warnings (⚠️ not supported) are shown for fields the simulator cannot perfectly mimic (e.g., `is_edited`, `crosspost_*`), instead of silently ignoring them.
*   **Curated Pattern Library:** 8 robust, community-verified rule templates (e.g., Age Gates, Spam Filters). Uses an interactive wizard to prompt the user for specific parameters (like minimum karma) and automatically injects the perfectly formatted YAML into the draft.

### E. Health Telemetry & Education
*   **Algorithmic Health Grading:** Grades configurations from A to F based on a weighted formula: Validation Cleanliness (30%), Action Diversity (15%), Documentation Coverage (15%), Safety Patterns (20%), Type Specificity (10%), and Rule Count Health (10%).
*   **Sparkline History:** Visualizes the health trajectory across the last 15 deployments using an SVG chart.
*   **Training Missions:** 3 localized, interactive scenarios (Beginner, Intermediate, Advanced) teaching moderators how to fix broken syntax, secure unsafe rules, and write from scratch. Progress is tracked via `localStorage`.

### F. Premium UI/UX Ecosystem
*   **Role-Based Theming & Glassmorphism:** Features a 7-panel architecture with deep frosted-glass backgrounds, glowing accents, and dynamic tab coloring (Teal, Amber, Purple, Pink).
*   **True Dark/Light Mode:** Toggleable theme with zero-flash persistence.
*   **Feather Icons & Tooltips:** High-res SVG icons with `z-index: 9999` positional tooltips to prevent modal clipping.
*   **Toast System:** Auto-dismissing success and error notifications equipped with animated progress bars.

---

## 3. Core Workflows

### Workflow 1: The Deployment & Validation Lifecycle
1.  **Load:** User opens the "Draft" tab. The system pulls either the `Active Config` or a `Recovered Draft`. A Redis lease is acquired and pinged every 60s.
2.  **Edit:** User modifies YAML. The `yaml-parser.js` and `validation.js` run syntactical checks every 500ms.
3.  **Validate:** User clicks "Deep Validate". The `guardrails.js` parses semantic meaning, surfacing warnings (e.g., "short includes string without includes-word") and errors.
4.  **Policy Check:** The UI evaluates `this.settings.policyRules`. If Safe Mode is on, or Config Freeze is active, the Deploy button remains locked.
5.  **Deploy:** Upon clicking deploy, the Devvit Backend intercepts the payload, runs a server-side permission check, creates an `auto` tier snapshot of the *current* state, updates the Reddit Wiki via `context.reddit.updateWikiPage()`, logs the deployment to the Audit Trail, and releases the Redis lease.

### Workflow 2: Team Proposal & Approval Pipeline
1.  **Propose:** Instead of deploying directly, a user clicks "Submit Proposal".
2.  **Assessment:** The user fills out a Proposal Title, Rationale, Risk Level (Low/Medium/High), and a checklist (e.g., "Affects Mod Actions").
3.  **State Transition (Proposed):** The config is saved to the backend Proposal pool.
4.  **Review & Diff:** Other moderators navigate to the "Proposals" tab, click "View Diff" to see exactly what this proposal changes against the active config.
5.  **Approval Gate:** Moderators click "Approve". Once the approval count meets the required threshold (e.g., 2), the state transitions to `Approved`, unlocking the "Deploy" button.
6.  **Resolution:** The Proposal is deployed (transitioning to `Deployed`) or denied (`Rejected`).

### Workflow 3: Emergency Incident Response
1.  **Crisis Identification:** A rogue Automod rule begins nuking legitimate posts.
2.  **Emergency Brake:** A moderator clicks the high-visibility red "BRAKE" button in the header.
3.  **Atomic Resolution:** In a single server-side transaction, VigilonX:
    *   Finds the most recent `milestone` or `manual` snapshot.
    *   Overwrites the live Wiki page with that stable config.
    *   Toggles `configFreeze = true` in settings to prevent further damage.
    *   Logs an `EMERGENCY_BRAKE` event to the immutable Audit Trail.
4.  **Broadcast:** The UI instantly updates, showing the Config Freeze banner to all active sessions.

### Workflow 4: Conflict Resolution & Sync
1.  **External Edit:** A moderator edits the automod wiki directly on old.reddit.com, bypassing VigilonX.
2.  **Detection:** Upon next load, VigilonX compares the stored `activeRevisionId` against the actual Reddit Wiki `revisionId`.
3.  **Conflict Banner:** A severe warning banner is shown: "External Edit Detected".
4.  **Resolution Options:** The user can click "Acknowledge & Fork" to ingest the external changes, automatically creating an `external-edit` labeled snapshot for auditing, and updating the internal tracker.

---

## 4. Technical Architecture & Component Breakdown

### System Dependencies
*   **Platform:** Reddit Devvit SDK (`@devvit/public-api` version `0.12.x`)
*   **Communication:** `useWebView` hook coupled with a strict `postMessage` protocol utilizing typescript discriminated unions (`WebViewMessage` / `DevvitMessage`).
*   **Storage:** Redis plugin (`@devvit/redis`) utilizing String keys for Session Leasing and Settings, and Sorted Sets (`zRange` with `by: 'rank'`) for time-series Snapshot and Audit indexing.

### Backend Structure (`src/`)
*   **`main.tsx` (55KB, ~1340 lines):** The brain of the operation. Contains:
    *   `AutomodConfigService`: Manages Reddit API interactions, strict revision tracking, and conflict state. Catches Reddit's `special_errors` (Wiki syntax rejections).
    *   `SnapshotService`: Handles tier-based snapshot rotation and storage.
    *   `SettingsService` & `ProposalService`: Manages governance rules and proposal state machines.
    *   `LeaseService`: Enforces concurrency control.
*   **`message.ts` (12KB):** The TypeScript interface contract ensuring frontend-backend payload alignment.

### Frontend SPA (`webroot/`)
*   **`page.html` (28KB):** DOM structure comprising the 7 panels (Draft, Versions, Simulator, Health, Patterns, Proposals, Settings) and 5 distinct Modals.
*   **`script.js` (56KB, 1220+ lines):** The monolith SPA controller. Handles DOM manipulation, Theme persistence, Draft recovery (`localStorage`), Lease ping heartbeats, and UI state hydration.
*   **`style.css` (26KB):** Complete custom styling engine implementing CSS variables, backdrop-filters for glassmorphism, responsive grid layouts, and dynamic severity color coding (e.g., `--danger`, `--warning`).
*   **`yaml-parser.js` & `validation.js`:** Custom client-side parsing tree capable of handling AutoModerator's `---` document separators and array mappings without heavy Node.js YAML dependencies.
*   **`rule-tester.js`:** The Simulation engine that maps user input (Author Age, Karma, Body Text) against parsed regex and string matching algorithms to return confidence scores.
*   **`guardrails.js` & `health-score.js`:** Telemetry models containing the static analysis matrices and the 6-factor algebraic grading formulas.

## 5. File Directory Context

```
VigilonX/
├── src/
│   ├── main.tsx          # Core Devvit Blocks & Redis API Gateway
│   └── message.ts        # Bidirectional type definitions
├── webroot/
│   ├── page.html          # Webview DOM & Modals
│   ├── script.js          # App Controller / State Manager
│   ├── style.css          # Design System & Theming
│   ├── yaml-parser.js     # Bespoke AutoMod YAML AST parser
│   ├── validation.js      # Syntactic & Syntax validator
│   ├── guardrails.js      # Semantic linter / best practices engine
│   ├── rule-tester.js     # Offline AutoMod simulator
│   ├── diff-engine.js     # Rule-level YAML comparative engine
│   ├── health-score.js    # 6-factor grading and SVG chart generator
│   ├── pattern-library.js # Community rule templates and generator UI
│   ├── training.js        # Educational mission state tracker
│   └── sample-config.yaml # Internal test fixture
├── devvit.yaml            # Devvit configuration
├── package.json           # npm dependencies
├── tsconfig.json          # TS compiler rules
├── devlog.md              # Historical development log
├── ABOUT.md               # Project inspiration and narrative history
└── PROJECT_DESCRIPTION.md # This exhaustive master reference document
```

## 6. Playtesting & Deployment
```bash
# Ensure strict type compliance
npm run type-check

# Launch a local playtest against a test subreddit
npx devvit playtest r/YourSubreddit

# Push to Reddit's Devvit Infrastructure
npx devvit upload
```
