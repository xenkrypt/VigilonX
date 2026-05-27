// ============================================================================
// VigilonX – Shared Message Types
// Defines the communication contract between Devvit Blocks and the Webview.
// ============================================================================

// ---------------------------------------------------------------------------
// Data models
// ---------------------------------------------------------------------------

/** Snapshot tier classification */
export type SnapshotTier = 'auto' | 'manual' | 'milestone';

/** A snapshot of an Automod configuration. */
export type Snapshot = {
  id: string;
  subredditName: string;
  timestamp: string;       // ISO 8601
  author: string;          // Reddit username of the mod who triggered it
  note: string;            // Free-text description
  configYaml: string;      // Full YAML content
  isActive: boolean;       // True if this snapshot represents the currently-live config
  tier: SnapshotTier;      // auto, manual, or milestone
  labels: string[];        // e.g. ['stable', 'pre-raid', 'experimental']
  isPinned: boolean;       // Pinned milestone snapshots
  configHash?: string;     // Hash of config content for integrity and conflict detection
};

/** A lightweight summary of an archived snapshot to save storage space. */
export type SnapshotArchive = {
  id: string;
  timestamp: string;
  author: string;
  healthScore: number;
  diffSummary: string;
};

/** Result of YAML / Automod validation. */
export type ValidationResult = {
  isValid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  ruleCount: number;
  lineCount: number;
  charCount: number;
};

export type ValidationIssue = {
  message: string;
  path?: string;
  line?: number;
};

/** A single item to test against Automod rules. */
export type TestItem = {
  title: string;
  body: string;
  domain: string;
  isSelf: boolean;
  authorAccountAgeDays: number;
  authorKarma: number;
  authorName: string;
  flair: string;
};

/** Result of simulating rules against a test item. */
export type RuleMatchResult = {
  ruleIndex: number;
  ruleName: string;
  action: string;
  matchedChecks: string[];
  warnings: string[];
  coverageFlag?: 'full' | 'partial' | 'none'; // Simulator coverage for this rule
  confidenceScore?: number; // 0-100
};

export type SimulationResult = {
  matches: RuleMatchResult[];
  totalRulesChecked: number;
  disclaimer: string;
};

/** A suite of test items to run multi-scenario tests. */
export type TestSuite = {
  id: string;
  name: string;
  items: TestItem[];
};

/** A deploy event for monitoring. */
export type DeployEvent = {
  id: string;
  timestamp: string;
  author: string;
  previousSnapshotId: string | null;
  newSnapshotId: string;
  note: string;
  isStaged?: boolean;       // If this deploy is a staged/candidate deploy
  stagedExpiry?: string;     // ISO timestamp when staged deploy auto-rolls back
  stagedStatus?: 'candidate' | 'confirmed' | 'auto-rolled-back';
};

/** User permissions for this subreddit. */
export type UserPermissions = {
  canView: boolean;
  canEdit: boolean;
  username: string;
};

/** Application-level settings stored in Redis. */
export type AppSettings = {
  operatingMode: 'safe' | 'standard' | 'power';
  readOnlyMode: boolean;            // Deprecated/Legacy, prefer operatingMode = 'safe'
  requireApprovals: boolean;        // Require N approvals before deploy
  requiredApprovalCount: number;    // Number of approvals needed
  sandboxSubreddits: string[];      // Linked sandbox subreddit names
  defaultStagedWindowHours: number; // Default staged deploy window (0 = off)
  retentionPolicies: {
    system: number;
    manual: number;
    milestone: number; // usually 0 meaning infinite
  };
  ecosystemAwareness: {
    aiAutomod: boolean;
    mirrorSync: boolean;
  };
  crossSubFeatures: boolean;
  configFreeze?: boolean;
  policyRules?: {
    requireDeepValidate: boolean;
    requireSandboxDeploy: boolean;
    requireRecentMilestone: boolean;
  };
};

/** An edit session lease to prevent concurrent overwrites. */
export type EditSessionLease = {
  subredditName: string;
  user: string;
  startTime: number;
  baseRevisionId: string;
};

/** A curated pattern from the pattern library. */
export type Pattern = {
  id: string;
  name: string;
  category: string;            // e.g. 'spam', 'quality', 'gating', 'reply'
  description: string;         // Plain-language explanation
  yaml: string;                // YAML snippet
  examplesCatch: string[];     // Posts this should catch
  examplesMiss: string[];      // Posts this should not catch
  parameters?: PatternParam[]; // Configurable parameters
  isBuiltIn: boolean;          // true = shipped with app, false = community-saved
  author?: string;             // Who saved it (for community patterns)
};

export type PatternParam = {
  key: string;           // e.g. 'min_age_days'
  label: string;         // e.g. 'Minimum Account Age (days)'
  type: 'number' | 'text' | 'select' | 'multi-select' | 'boolean';
  default: string | number | boolean;
  options?: string[];    // For select/multi-select
  min?: number;
  max?: number;
};

/** A change proposal for collaborative review. */
export type Proposal = {
  id: string;
  title: string;
  description: string;
  rationale: string;
  riskLevel: 'low' | 'medium' | 'high';
  configYaml: string;
  author: string;
  timestamp: string;
  status: 'draft' | 'proposed' | 'under_review' | 'approved' | 'rejected' | 'deployed' | 'archived';
  approvals: string[];       // Usernames who approved
  comments: ProposalComment[];
  checklist?: {
    affectsModActions: boolean;
    interactsWithBots: boolean;
  };
};

export type ProposalComment = {
  id: string;
  author: string;
  timestamp: string;
  text: string;
};

/** Rule-level diff result. */
export type RuleDiff = {
  type: 'added' | 'removed' | 'modified' | 'moved' | 'unchanged';
  ruleIndex: number;
  oldRaw?: string;
  newRaw?: string;
  oldAction?: string;
  newAction?: string;
  summary: string;       // Human-readable summary of what changed
  severity: 'safe' | 'warning' | 'danger';
};

export type DiffSummary = {
  added: number;
  removed: number;
  modified: number;
  moved?: number;
  unchanged: number;
  diffs: RuleDiff[];
};

/** Config health score. */
export type HealthScore = {
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  score: number;                  // 0-100
  breakdown: HealthFactor[];
};

export type HealthFactor = {
  name: string;
  score: number;      // 0-100
  weight: number;     // 0-1
  detail: string;
};

/** Rule documentation metadata */
export type RuleDoc = {
  ruleHash: string;          // Hash of key rule fields for stable ID
  description: string;       // Human description
  addedReason: string;       // "Why we added this"
  relatedLinks: string[];    // Links to threads / incidents
  author: string;
  lastUpdated: string;
};

/** Training mission for mod onboarding. */
export type TrainingMission = {
  id: string;
  title: string;
  description: string;
  brokenYaml: string;         // YAML with intentional mistakes
  hints: string[];
  expectedFixCount: number;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
};

/** Audit trail entry for export. */
export type AuditEntry = {
  timestamp: string;
  type: 'deploy' | 'rollback' | 'snapshot' | 'proposal' | 'setting_change';
  author: string;
  detail: string;
  snapshotId?: string;
};

// ---------------------------------------------------------------------------
// Messages from the Webview → Devvit
// ---------------------------------------------------------------------------

export type WebViewMessage =
  | { type: 'webViewReady' }
  // Config
  | { type: 'getActiveConfig' }
  | { type: 'getPermissions' }
  // Snapshots
  | { type: 'listSnapshots' }
  | { type: 'getSnapshot'; data: { snapshotId: string } }
  | { type: 'createSnapshot'; data: { note: string; tier?: SnapshotTier; labels?: string[] } }
  | { type: 'rollbackToSnapshot'; data: { snapshotId: string; note: string } }
  | { type: 'updateSnapshotLabels'; data: { snapshotId: string; labels: string[]; isPinned: boolean; tier: SnapshotTier } }
  // Deploy
  | { type: 'deployDraft'; data: { configYaml: string; note: string; staged?: boolean; stagedHours?: number; dryRun?: boolean } }
  | { type: 'confirmStagedDeploy'; data: { deployEventId: string } }
  | { type: 'pullExternalConfig'; data: { revisionId: string } }
  | { type: 'forceOverwriteConfig'; data: { configYaml: string; note: string } }
  // Deploy history
  | { type: 'listDeployEvents' }
  // Sample recent posts (optional)
  | { type: 'sampleRecentPosts'; data: { count: number } }
  // Settings
  | { type: 'getSettings' }
  | { type: 'updateSettings'; data: { settings: AppSettings } }
  // Proposals
  | { type: 'listProposals' }
  | { type: 'createProposal'; data: { title: string; description: string; rationale: string; riskLevel: 'low' | 'medium' | 'high'; configYaml: string } }
  | { type: 'approveProposal'; data: { proposalId: string } }
  | { type: 'rejectProposal'; data: { proposalId: string } }
  | { type: 'addProposalComment'; data: { proposalId: string; text: string } }
  | { type: 'deployProposal'; data: { proposalId: string } }
  // Community patterns
  | { type: 'listCommunityPatterns' }
  | { type: 'saveCommunityPattern'; data: { name: string; description: string; category: string; yaml: string } }
  | { type: 'deleteCommunityPattern'; data: { patternId: string } }
  // Rule docs
  | { type: 'getRuleDocs' }
  | { type: 'saveRuleDoc'; data: { ruleHash: string; description: string; addedReason: string; relatedLinks: string[] } }
  // Audit
  | { type: 'exportAuditTrail' }
  | { type: 'savePattern'; data: Partial<Pattern> }
  | { type: 'deletePattern'; data: { patternId: string } }
  | { type: 'pingLease'; data: { baseRevisionId: string } }
  | { type: 'breakLease'; data: {} }
  | { type: 'emergencyBrake' }
  // AI Assistance
  | { type: 'aiGenerateRule'; data: { prompt: string; apiKey: string; model: string } }
  | { type: 'aiExplainDraft'; data: { configYaml: string; apiKey: string; model: string } };

// ---------------------------------------------------------------------------
// Messages from Devvit → Webview
// ---------------------------------------------------------------------------

export type DevvitMessage =
  | { type: 'initialData'; data: { 
      config: string;
      activeRevisionId: string;
      lastKnownRevisionId: string;
      draft: string; 
      snapshots: Snapshot[]; 
      deployEvents: DeployEvent[];
      settings: AppSettings;
      proposals: Proposal[];
      patterns: Pattern[];
      permissions: UserPermissions;
      auditEntries: AuditEntry[];
      archives: SnapshotArchive[];
      activeLease?: EditSessionLease;
      subredditName: string;
    } }
  | { type: 'configUpdated'; data: { config: string; revisionId: string } }
  | { type: 'permissionsResult'; data: UserPermissions }
  | { type: 'activeConfigResult'; data: { configYaml: string; revisionId: string } }
  | { type: 'snapshotListResult'; data: { snapshots: Snapshot[] } }
  | { type: 'snapshotResult'; data: { snapshot: Snapshot | null } }
  | { type: 'snapshotCreated'; data: { snapshot: Snapshot } }
  | { type: 'snapshotUpdated'; data: { snapshot: Snapshot } }
  | { type: 'rollbackComplete'; data: { snapshot: Snapshot; newActiveConfig: string } }
  | { type: 'deployComplete'; data: { snapshot: Snapshot; deployEvent: DeployEvent } }
  | { type: 'deployEventsResult'; data: { deployEvents: DeployEvent[] } }
  | { type: 'recentPostsResult'; data: { posts: Array<{ title: string; body: string; domain: string; authorName: string }> } }
  | { type: 'settingsResult'; data: { settings: AppSettings } }
  | { type: 'settingsUpdated'; data: { settings: AppSettings } }
  | { type: 'proposalListResult'; data: { proposals: Proposal[] } }
  | { type: 'proposalCreated'; data: { proposal: Proposal } }
  | { type: 'proposalUpdated'; data: { proposal: Proposal } }
  | { type: 'communityPatternsResult'; data: { patterns: Pattern[] } }
  | { type: 'communityPatternSaved'; data: { pattern: Pattern } }
  | { type: 'communityPatternDeleted'; data: { patternId: string } }
  | { type: 'ruleDocsResult'; data: { docs: RuleDoc[] } }
  | { type: 'ruleDocSaved'; data: { doc: RuleDoc } }
  | { type: 'auditTrailResult'; data: { entries: AuditEntry[] } }
  | { type: 'error'; data: { message: string; context?: string } }
  | { type: 'toast'; data: { message: string; appearance?: 'success' | 'neutral' } }
  // AI Assistance
  | { type: 'aiGenerateResult'; data: { yaml: string; success: boolean; error?: string } }
  | { type: 'aiExplainResult'; data: { explanation: string; success: boolean; error?: string } };

/**
 * Wrapper type for messages received by the webview.
 * Devvit wraps all postMessage calls in this envelope.
 */
export type DevvitSystemMessage = {
  data: { message: DevvitMessage };
  type?: 'devvit-message' | string;
};
