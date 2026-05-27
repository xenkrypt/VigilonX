# VigilonX – SRE Control Plane for AutoModerator

## 1. Project Overview & Philosophy

VigilonX is an advanced Reddit Devvit Application architected to serve as a professional Site Reliability Engineering (SRE) Control Plane for AutoModerator. Managing complex AutoModerator rules via plain text wiki pages is fraught with risks: typos can cause catastrophic community disruptions, and there is no native support for staging, linting, testing, or automated incident response. 

By unifying the Devvit Mod Tool capabilities with a rich Custom Post Webview interface, VigilonX brings enterprise-grade software engineering practices—version control, visual rule diffing, offline rule simulation, health scoring, and safe staging environments—directly into the subreddit moderation ecosystem.

**The Prime Directive:** VigilonX is engineered with a non-negotiable core guarantee: *It will never lose, silently corrupt, or accidentally overwrite your active AutoModerator configuration.*

---

## 2. Exhaustive Feature Matrix

### A. Version Control & Snapshot Engine ("Git for Automod")
*   **Continuous Snapshotting:** Every time a deployment occurs, VigilonX securely archives the previous state as a snapshot.
*   **Milestone Architecture:** Moderators can pin specific, known-stable configurations as "Milestones." These represent verified configurations that serve as critical fallback points during active subreddit attacks or emergencies.
*   **Active Tracking:** The currently deployed configuration is dynamically fetched and flagged as `ACTIVE`, ensuring the local client state is perfectly aligned with the live subreddit wiki.
*   **Wiki Conflict Detection:** If a configuration is edited externally via Old Reddit or the native Mod Tools, VigilonX detects the revision mismatch and triggers a mandatory "Pull & Diff" conflict resolution protocol, preventing unintentional overwrites.
*   **Visual Diff Engine:** A robust comparative engine that visualizes exact YAML additions, deletions, and modifications between the Active config, the Draft config, and historical Snapshots.

### B. Intelligent Draft Editor & Validation Pipeline
*   **Quarantined State:** All edits, whether manual or generated via AI or templates, are contained strictly within a local, sandboxed `Draft` state.
*   **Deep Semantic Validation (Guardrails):** Beyond basic YAML syntax checking, VigilonX performs a full semantic analysis of AutoModerator logic. It actively detects unconstrained removal actions, dangerously broad regex patterns prone to catastrophic backtracking, and missing documentation.
*   **Syntax & Typo Hardening:** The validation engine explicitly verifies AutoMod quirks, ensuring that variables like `account_age` use operator syntax (e.g., `< 1 days`) and that required rule keys are properly structured.

### C. Offline Simulation & Testing
*   **Deterministic Rule Simulator:** A powerful offline testing engine that allows moderators to execute their active or drafted YAML rules against synthetic Reddit payloads.
*   **Simulated Attributes:** Create complex testing scenarios by mocking parameters such as Author Karma, Account Age, Submission Domain, Text Body, and specific Post Flairs.
*   **Feedback & Diagnostics:** The simulator outputs exact match results, indicating exactly which rules fired against the payload and which conditions failed, providing total confidence before deploying to production.

### D. Incident Response & Safety Governance
*   **The FREEZE Protocol:** A master emergency toggle that instantly locks the configuration pipeline globally. In the event of an Automod misconfiguration damaging the subreddit, a moderator can hit FREEZE to block any further deployments until the situation is resolved.
*   **Deployment Safety Profiles:**
    *   **Relaxed:** Minimal restrictions, optimized for rapid iteration.
    *   **Standard:** Balanced safety that requires basic syntax validation to pass before deployment.
    *   **Strict:** Hard-gating that demands a 100% clean Deep Validation run (zero guardrail warnings or semantic errors) before the Deploy button unlocks.

### E. Health Telemetry & Workflow Acceleration
*   **Algorithmic Health Grading:** Evaluates the technical debt of the entire AutoModerator configuration. It grades the configuration from A to F based on a weighted formula factoring in: Validation Cleanliness, Action Diversity, Documentation Coverage, Safety Patterns, and Rule Complexity.
*   **AI Rule Compilation:** Transforms natural language requirements into perfectly formatted AutoModerator YAML. The AI operates under customizable behavioral profiles (Conservative, Balanced, Aggressive) to control the restrictiveness of the generated code.
*   **Curated Pattern Library:** A built-in repository of battle-tested, community-verified rule templates (e.g., Advanced Age Gating, T-Shirt Spam Filters). Users can seamlessly inject these standardized patterns directly into their drafts.

### F. Premium UI/UX Ecosystem
*   **Cinematic Operational Interface:** Features a modular tab-based architecture with deep frosted-glass backgrounds, glowing accents, and an unapologetically infrastructure-oriented aesthetic.
*   **Persistent UI States:** Customizable UI Density (Compact, Comfortable, Expanded) and Motion Effects (Off, Subtle, Full).
*   **Toast System:** Non-blocking, auto-dismissing success and error telemetry notifications.

---

## 3. Core Workflows

### Workflow 1: The Deployment & Validation Lifecycle
1.  **Staging:** User navigates to the "Draft & Validate" tab.
2.  **Edit:** The user modifies the YAML config.
3.  **Validate:** The user clicks "Deep Validate". The validation engine parses semantic meaning, surfacing any architectural warnings.
4.  **Policy Check:** The UI evaluates the selected Safety Profile. If Strict Mode is active and warnings exist, the deployment is hardware-locked.
5.  **Deploy:** Upon successful validation, the system takes an atomic snapshot of the *current* state, updates the Reddit Wiki via the Devvit API, logs the deployment, and upgrades the Draft to ACTIVE.

### Workflow 2: Safe Iteration via Simulator
1.  **Drafting:** A moderator writes a complex regex filter to block novel spam domains.
2.  **Mocking:** They switch to the "Rule Tester" tab and configure a synthetic post mirroring the spam campaign.
3.  **Execution:** Clicking "Run Test" parses the draft YAML locally without touching production, confirming if the rule successfully catches the mocked payload.
4.  **Refinement:** If the rule misses, the moderator adjusts the draft and retests until perfect confidence is achieved.

### Workflow 3: Emergency Incident Response
1.  **Crisis Identification:** An aggressive Automod rule begins improperly removing legitimate user content.
2.  **Emergency Brake:** A senior moderator hits the high-visibility "FREEZE" button.
3.  **Containment:** The system broadcasts a Config Freeze lock to all active sessions, preventing any junior moderators from pushing panicked, untested fixes.
4.  **Rollback:** The team navigates to the "Versions" tab, locates the last pinned Milestone snapshot, and executes a one-click atomic rollback to restore stability.

---

## 4. Technical Architecture

### Platform & Dependencies
*   **Platform:** Reddit Devvit SDK
*   **Communication:** `useWebView` hook coupled with a strict bidirectional `postMessage` protocol.
*   **Storage Framework:** Utilizes Devvit's internal storage primitives for reliable version snapshotting and telemetry tracking.

### Component Breakdown
*   **`src/main.tsx`:** The core Devvit Block rendering the minimal operational splash screen and acting as the API Gateway for Reddit Wiki read/write operations.
*   **`webroot/page.html`:** The DOM structure comprising the modular application architecture (Versions, Draft, Tester, Patterns, Health, Settings).
*   **`webroot/script.js`:** The monolith SPA controller handling state management, DOM reconciliation, validation pipeline triggers, and UI interactivity.
*   **`webroot/validation.js` & `guardrails.js`:** Custom client-side parsing engines capable of handling AutoModerator's bespoke YAML document structures and executing complex semantic analysis.
*   **`webroot/rule-tester.js`:** The deterministic regex and condition evaluation engine powering the offline simulator.
*   **`webroot/style.css`:** The custom design system providing the cinematic dark-mode aesthetic.

---

## 5. Deployment Commands

```bash
# Verify TypeScript compliance
npm run type-check

# Launch a local playtest against your test subreddit
npx devvit playtest r/YourSubreddit

# Push to Reddit's Devvit Infrastructure
npx devvit upload
```
