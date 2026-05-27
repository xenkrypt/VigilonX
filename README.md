# VigilonX

**The Site Reliability Engineering (SRE) Control Plane for Reddit AutoModerator.**

VigilonX elevates subreddit moderation to professional infrastructure standards. By providing a unified Devvit Application interface, it brings modern software engineering paradigms—version control, deterministic offline testing, semantic validation, and incident response—directly into the moderation ecosystem.

---

## 📖 Overview

AutoModerator is the backbone of Reddit community safety, but editing its configuration directly via plain-text wiki pages is a high-risk operation. A single malformed regex, a missing action reason, or a logical flaw can cause catastrophic, silent failures across an entire community. 

VigilonX solves this by introducing a strict **Staging Pipeline**. Moderators author rules in a locally contained sandboxed environment, validate syntax offline, test edge cases against simulated payloads, and deploy to live infrastructure with confidence—knowing a one-click rollback is always available.

## ✨ Core Capabilities

### 🛡️ Version Control & Configuration Snapshots
- **Continuous Snapshot Architecture**: VigilonX maintains an exhaustive, searchable history of your AutoModerator configurations. 
- **Milestone Pinning**: Explicitly pin known-stable configurations as immutable milestones.
- **Instant Rollback**: Recover from bad deployments instantly by reverting to any historical state. 
- **Atomic Commits**: All updates to the active AutoModerator wiki are performed atomically via the Reddit Devvit API.
- **Wiki Conflict Detection**: If a moderator edits the wiki externally via Old Reddit, VigilonX detects the revision mismatch and enforces a "Pull & Diff" resolution flow before allowing new deployments.

### 🧪 Safe Staging, Validation & Testing
- **Offline Rule Simulator (Tester)**: Simulate synthetic Reddit items (posts and comments) with granular attributes (account age, domain, flair) against your draft configuration to observe precise matching behavior offline.
- **Semantic Guardrails**: Beyond standard YAML syntax linting, VigilonX parses the semantic intent of rules, surfacing warnings for unconstrained `remove` actions, missing documentation, and dangerously broad regex patterns.
- **Quarantined State**: All edits occur strictly within a localized Draft state. Nothing touches production until explicit validation and deployment criteria are met.

### 🚨 Operational Incident Response
- **The FREEZE Protocol**: During active subreddit attacks (e.g., bot waves or coordinated spam), moderators can trigger a global deployment lock. This disables all write operations to the active configuration until the freeze is lifted by a senior operator.
- **Safety Profiles**: Enforce strict deployment gating. 
    - *Relaxed*: Minimal restrictions for rapid prototyping.
    - *Standard*: Balanced safeguards requiring basic validation.
    - *Strict*: Hard-gating that demands full Deep Validation and zero guardrail errors before deployment is unlocked.

### 🏗️ Workflow Acceleration & Telemetry
- **Configurable AI Generation**: Transform natural language operational requirements into formatted AutoModerator YAML. AI behavior is tightly controlled via operational profiles (*Conservative, Balanced, Aggressive*).
- **Interactive Pattern Library**: Inject battle-tested, community-standard templates directly into your draft. 
- **Algorithmic Health Grading**: Track configuration technical debt over time with a 6-factor algebraic health score, ensuring rules remain maintainable, performant, and correctly documented.

---

## 🚀 Getting Started

VigilonX is a Devvit application designed to run seamlessly within the Reddit ecosystem.

### Prerequisites
- Node.js (v18+)
- Devvit CLI installed globally (`npm install -g @devvit/cli`)
- A test subreddit where you have full moderation configuration permissions.

### Local Development

1. **Clone & Install**
   ```bash
   git clone https://github.com/your-repo/VigilonX.git
   cd VigilonX
   npm install
   ```

2. **Run Type Checks**
   Ensure all TypeScript compiles cleanly before deployment:
   ```bash
   npm run type-check
   ```

3. **Launch the Playtest Simulator**
   Start the local Devvit environment connected to your test subreddit:
   ```bash
   devvit playtest r/YourTestSubreddit
   ```

### Production Deployment

To deploy VigilonX to Reddit's production Devvit infrastructure:
```bash
devvit upload
```

---

## 🏗️ Architecture & Stack

VigilonX operates on a decoupled architecture, isolating the Reddit API communication layer from the heavy lifting of the webview interface.

```text
VigilonX/
├── src/
│   ├── main.tsx             # Devvit Blocks, UI Splash Screen & API Gateway
│   └── message.ts           # Discriminated union protocols for Webview messaging
├── webroot/                 # Vanilla JS/CSS Webview Payload
│   ├── script.js            # Frontend State Controller & Lifecycle management
│   ├── style.css            # Custom Design System (Glassmorphism, Dark Mode)
│   ├── validation.js        # Syntactic Validation Engine (YAML AST parsing)
│   ├── rule-tester.js       # Offline Simulation Engine
│   ├── guardrails.js        # Semantic Linter & Health Grader
│   └── page.html            # Core Webview DOM
└── devvit.yaml              # App Manifest & Infrastructure configuration
```

---

## 📚 Documentation

For a comprehensive breakdown of operational workflows, including disaster recovery, health scoring rubrics, and the rule simulation engine, please read the [Operational Guide](OPERATIONAL_GUIDE.md).

---

## 🔒 The Prime Directive

VigilonX operates under a strict, non-negotiable guarantee: **It will never lose, silently corrupt, or accidentally overwrite your active AutoModerator configuration.** Every change is tracked, and every deployment can be reversed.
