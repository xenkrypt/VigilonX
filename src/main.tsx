// ============================================================================
// VigilonX – Main Devvit Entry Point
// Combines the Mod Tool menu pattern with a Webview custom post for the
// Automod Lab dashboard.
// ============================================================================

import { Devvit, useState, useWebView } from '@devvit/public-api';

import type {
  DevvitMessage,
  WebViewMessage,
  Snapshot,
  SnapshotTier,
  SnapshotArchive,
  DeployEvent,
  UserPermissions,
  AppSettings,
  EditSessionLease,
  Pattern,
  Proposal,
  ProposalComment,
  RuleDoc,
  AuditEntry,
} from './message.js';

// ---------------------------------------------------------------------------
// Configure capabilities
// ---------------------------------------------------------------------------

Devvit.configure({
  redditAPI: true,
  redis: true,
});

// ---------------------------------------------------------------------------
// Incident Management (Modlog Stub)
// ---------------------------------------------------------------------------

Devvit.addTrigger({
  event: 'ModAction',
  onEvent: async (event, context) => {
    // Phase 5 Stub: Track removal spikes. If > X removals in Y minutes,
    // generate an "Incident Snapshot" of the current config for investigation.
    // For now, we just log it to console or potentially an incident metric.
    if (event.action === 'removelink' || event.action === 'removecomment') {
      // console.log(`[VigilonX Incident] Removal detected: ${event.targetPost?.id}`);
    }
  },
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTOMOD_WIKI_PAGE = 'config/automoderator';
const SNAPSHOT_PREFIX = 'vigilonx:snapshot:';
const SNAPSHOT_INDEX_KEY = 'vigilonx:snapshot_index';
const DEPLOY_EVENT_PREFIX = 'vigilonx:deploy:';
const DEPLOY_EVENT_INDEX_KEY = 'vigilonx:deploy_index';
const SETTINGS_KEY = 'vigilonx:settings';
const PROPOSAL_PREFIX = 'vigilonx:proposal:';
const PROPOSAL_INDEX_KEY = 'vigilonx:proposal_index';
const PATTERN_PREFIX = 'vigilonx:pattern:';
const PATTERN_INDEX_KEY = 'vigilonx:pattern_index';
const RULEDOC_PREFIX = 'vigilonx:ruledoc:';
const RULEDOC_INDEX_KEY = 'vigilonx:ruledoc_index';
const AUDIT_PREFIX = 'vigilonx:audit:';
const AUDIT_INDEX_KEY = 'vigilonx:audit_index';
const ARCHIVE_PREFIX = 'vigilonx:archive:';
const ARCHIVE_INDEX_KEY = 'vigilonx:archive_index';
const LAST_KNOWN_REVISION_KEY = 'vigilonx:last_known_revision';
const ACTIVE_SNAPSHOT_KEY = 'vigilonx:active_snapshot_id';
const DEPLOY_LOCK_TTL_MS = 60_000;

const DEFAULT_SETTINGS: AppSettings = {
  operatingMode: 'safe',
  readOnlyMode: false,
  requireApprovals: false,
  requiredApprovalCount: 1,
  sandboxSubreddits: [],
  defaultStagedWindowHours: 0,
  retentionPolicies: {
    system: 50,
    manual: 20,
    milestone: 0,
  },
  ecosystemAwareness: {
    aiAutomod: true,
    mirrorSync: true,
  },
  crossSubFeatures: false,
};

// ---------------------------------------------------------------------------
// Utility: Generate a short unique ID
// ---------------------------------------------------------------------------

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const timestamp = Date.now().toString(36);
  let random = '';
  for (let i = 0; i < 6; i++) {
    random += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${timestamp}-${random}`;
}

type DeployLock = {
  key: string;
  token: string;
};

async function acquireDeployLock(
  context: Devvit.Context,
  owner: string
): Promise<DeployLock | null> {
  const subreddit = await context.reddit.getCurrentSubreddit();
  const key = `vigilonx:deploy_lock:${subreddit.name}`;
  const token = `${owner}:${Date.now()}:${generateId()}`;
  const acquired = await context.redis.set(key, token, {
    expiration: new Date(Date.now() + DEPLOY_LOCK_TTL_MS),
    nx: true,
  });
  return acquired ? { key, token } : null;
}

async function releaseDeployLock(
  context: Devvit.Context,
  lock: DeployLock
): Promise<void> {
  const current = await context.redis.get(lock.key).catch(() => undefined);
  if (current === lock.token) {
    await context.redis.del(lock.key).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Service: AutomodConfigService
// ---------------------------------------------------------------------------

async function getCurrentConfigWithRevision(
  context: Devvit.Context
): Promise<{ content: string; revisionId: string }> {
  const subreddit = await context.reddit.getCurrentSubreddit();
  try {
    const page = await context.reddit.getWikiPage(
      subreddit.name,
      AUTOMOD_WIKI_PAGE
    );
    return { content: page.content, revisionId: page.revisionId };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('404') || message.includes('not found') || message.includes('WIKI_DISABLED')) {
      return { content: '', revisionId: '' };
    }
    throw new Error(`Failed to fetch Automod config: ${message}`);
  }
}

async function getCurrentConfig(
  context: Devvit.Context
): Promise<string> {
  const { content } = await getCurrentConfigWithRevision(context);
  return content;
}

async function setConfig(
  context: Devvit.Context,
  newConfig: string,
  reason: string,
  ignoreFreeze: boolean = false
): Promise<void> {
  const settings = await getSettings(context);
  if (settings.configFreeze && !ignoreFreeze) {
    throw new Error('Config Freeze is currently active. Deploys are disabled.');
  }
  const subreddit = await context.reddit.getCurrentSubreddit();
  try {
    const page = await context.reddit.updateWikiPage({
      subredditName: subreddit.name,
      page: AUTOMOD_WIKI_PAGE,
      content: newConfig,
      reason: `[VigilonX] ${reason}`,
    });
    await context.redis.set(LAST_KNOWN_REVISION_KEY, page.revisionId);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Extract Reddit's special_errors for human-readable feedback
    const specialMatch = errMsg.match(/special_errors.*?\["(.*?)"\]/s);
    if (specialMatch) {
      throw new Error(`Reddit rejected the config: ${specialMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"')}`);
    }
    throw new Error(`Failed to update AutoMod config: ${errMsg.substring(0, 300)}`);
  }
}

async function checkPermissions(
  context: Devvit.Context
): Promise<UserPermissions> {
  try {
    const user = await context.reddit.getCurrentUser();
    if (!user) {
      return { canView: false, canEdit: false, username: 'unknown' };
    }
    const subreddit = await context.reddit.getCurrentSubreddit();
    const modPermissions = await user.getModPermissionsForSubreddit(
      subreddit.name
    );

    const isMod = modPermissions.length > 0;
    const canEdit =
      modPermissions.includes('all') ||
      modPermissions.includes('config') ||
      modPermissions.includes('wiki');

    return {
      canView: isMod,
      canEdit: canEdit,
      username: user.username,
    };
  } catch {
    return { canView: false, canEdit: false, username: 'unknown' };
  }
}

// ---------------------------------------------------------------------------
// Service: SnapshotService
// ---------------------------------------------------------------------------

async function createSnapshot(
  context: Devvit.Context,
  configYaml: string,
  author: string,
  note: string,
  isActive: boolean = false,
  tier: SnapshotTier = 'manual',
  labels: string[] = []
): Promise<Snapshot> {
  const subreddit = await context.reddit.getCurrentSubreddit();
  
  // Basic hash for config string to detect corruption/changes
  let hash = 0;
  for (let i = 0; i < configYaml.length; i++) {
    hash = ((hash << 5) - hash) + configYaml.charCodeAt(i);
    hash |= 0; 
  }
  
  const snapshot: Snapshot = {
    id: generateId(),
    subredditName: subreddit.name,
    timestamp: new Date().toISOString(),
    author,
    note,
    configYaml,
    isActive,
    tier,
    labels,
    isPinned: tier === 'milestone',
    configHash: Math.abs(hash).toString(16)
  };

  // Store the snapshot as a JSON hash
  await context.redis.set(
    `${SNAPSHOT_PREFIX}${snapshot.id}`,
    JSON.stringify(snapshot)
  );

  // Add to sorted set for chronological listing
  await context.redis.zAdd(SNAPSHOT_INDEX_KEY, { member: snapshot.id, score: Date.now() });
  
  // Asynchronously prune snapshots according to retention policies
  pruneSnapshots(context).catch(err => console.error('Failed to prune snapshots:', err));

  return snapshot;
}

async function pruneSnapshots(context: Devvit.Context): Promise<void> {
  const settings = await getSettings(context);
  const snapshots = await listSnapshots(context);
  
  const systemSnaps = snapshots.filter(s => s.tier === 'auto');
  const manualSnaps = snapshots.filter(s => s.tier === 'manual' && !s.isPinned);
  
  const toArchive: Snapshot[] = [];
  if (settings.retentionPolicies.system > 0 && systemSnaps.length > settings.retentionPolicies.system) {
    toArchive.push(...systemSnaps.slice(settings.retentionPolicies.system));
  }
  if (settings.retentionPolicies.manual > 0 && manualSnaps.length > settings.retentionPolicies.manual) {
    toArchive.push(...manualSnaps.slice(settings.retentionPolicies.manual));
  }
  
  for (const snap of toArchive) {
    // Create lightweight archive summary
    const archive: SnapshotArchive = {
      id: snap.id,
      timestamp: snap.timestamp,
      author: snap.author,
      healthScore: 0, // Simplified stub for archive
      diffSummary: snap.note || `Pruned ${snap.tier} snapshot`
    };
    await context.redis.set(`${ARCHIVE_PREFIX}${archive.id}`, JSON.stringify(archive));
    await context.redis.zAdd(ARCHIVE_INDEX_KEY, { member: archive.id, score: new Date(archive.timestamp).getTime() });
    
    // Delete full snapshot
    await context.redis.del(`${SNAPSHOT_PREFIX}${snap.id}`);
    await context.redis.zRem(SNAPSHOT_INDEX_KEY, [snap.id]);
  }
}

async function listArchives(context: Devvit.Context): Promise<SnapshotArchive[]> {
  const ids = await context.redis.zRange(ARCHIVE_INDEX_KEY, 0, -1, { reverse: true, by: 'rank' });
  if (!ids || ids.length === 0) return [];
  const archives: SnapshotArchive[] = [];
  for (const entry of ids) {
    const id = typeof entry === 'string' ? entry : entry.member;
    const raw = await context.redis.get(`${ARCHIVE_PREFIX}${id}`);
    if (raw) { try { archives.push(JSON.parse(raw) as SnapshotArchive); } catch { /* skip */ } }
  }
  return archives;
}

async function listSnapshots(
  context: Devvit.Context
): Promise<Snapshot[]> {
  // Get all snapshot IDs from sorted set, newest first
  const ids = await context.redis.zRange(SNAPSHOT_INDEX_KEY, 0, -1, {
    reverse: true,
    by: 'rank',
  });

  if (!ids || ids.length === 0) return [];

  const snapshots: Snapshot[] = [];
  for (const entry of ids) {
    const id = typeof entry === 'string' ? entry : entry.member;
    const raw = await context.redis.get(`${SNAPSHOT_PREFIX}${id}`);
    if (raw) {
      try {
        snapshots.push(JSON.parse(raw) as Snapshot);
      } catch {
        // Skip corrupted entries
      }
    }
  }

  return snapshots;
}

async function getSnapshotById(
  context: Devvit.Context,
  snapshotId: string
): Promise<Snapshot | null> {
  const raw = await context.redis.get(`${SNAPSHOT_PREFIX}${snapshotId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
}

async function markAllSnapshotsInactive(
  context: Devvit.Context
): Promise<void> {
  const previousActiveId = await context.redis.get(ACTIVE_SNAPSHOT_KEY);
  if (previousActiveId) {
    const prev = await getSnapshotById(context, previousActiveId);
    if (prev && prev.isActive) {
      prev.isActive = false;
      await context.redis.set(
        `${SNAPSHOT_PREFIX}${prev.id}`,
        JSON.stringify(prev)
      );
    }
    await context.redis.del(ACTIVE_SNAPSHOT_KEY);
  }
}

async function markSnapshotActive(
  context: Devvit.Context,
  snapshotId: string
): Promise<void> {
  // Clear only the previously-active snapshot instead of iterating all
  const previousActiveId = await context.redis.get(ACTIVE_SNAPSHOT_KEY);
  if (previousActiveId && previousActiveId !== snapshotId) {
    const prev = await getSnapshotById(context, previousActiveId);
    if (prev && prev.isActive) {
      prev.isActive = false;
      await context.redis.set(
        `${SNAPSHOT_PREFIX}${prev.id}`,
        JSON.stringify(prev)
      );
    }
  }
  // Activate the new snapshot and record its ID
  const snapshot = await getSnapshotById(context, snapshotId);
  if (snapshot) {
    snapshot.isActive = true;
    await context.redis.set(
      `${SNAPSHOT_PREFIX}${snapshot.id}`,
      JSON.stringify(snapshot)
    );
    await context.redis.set(ACTIVE_SNAPSHOT_KEY, snapshot.id);
  }
}

// ---------------------------------------------------------------------------
// Service: MonitoringService
// ---------------------------------------------------------------------------

async function recordDeployEvent(
  context: Devvit.Context,
  author: string,
  previousSnapshotId: string | null,
  newSnapshotId: string,
  note: string
): Promise<DeployEvent> {
  const event: DeployEvent = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    author,
    previousSnapshotId,
    newSnapshotId,
    note,
  };

  await context.redis.set(
    `${DEPLOY_EVENT_PREFIX}${event.id}`,
    JSON.stringify(event)
  );

  await context.redis.zAdd(DEPLOY_EVENT_INDEX_KEY, {
    member: event.id,
    score: Date.now(),
  });

  return event;
}

async function listDeployEvents(
  context: Devvit.Context
): Promise<DeployEvent[]> {
  const ids = await context.redis.zRange(DEPLOY_EVENT_INDEX_KEY, 0, -1, {
    reverse: true,
    by: 'rank',
  });

  if (!ids || ids.length === 0) return [];

  const events: DeployEvent[] = [];
  for (const entry of ids) {
    const id = typeof entry === 'string' ? entry : entry.member;
    const raw = await context.redis.get(`${DEPLOY_EVENT_PREFIX}${id}`);
    if (raw) {
      try {
        events.push(JSON.parse(raw) as DeployEvent);
      } catch {
        // Skip corrupted
      }
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Service: SettingsService
// ---------------------------------------------------------------------------

async function getSettings(context: Devvit.Context): Promise<AppSettings> {
  const raw = await context.redis.get(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}

async function saveSettings(context: Devvit.Context, settings: AppSettings): Promise<void> {
  await context.redis.set(SETTINGS_KEY, JSON.stringify(settings));
}

// ---------------------------------------------------------------------------
// Service: ProposalService
// ---------------------------------------------------------------------------

async function createProposal(context: Devvit.Context, data: { title: string; description: string; rationale: string; riskLevel: 'low'|'medium'|'high'; configYaml: string }, author: string): Promise<Proposal> {
  const proposal: Proposal = {
    id: generateId(), title: data.title, description: data.description,
    rationale: data.rationale, riskLevel: data.riskLevel, configYaml: data.configYaml,
    author, timestamp: new Date().toISOString(), status: 'proposed',
    approvals: [], comments: [],
  };
  await context.redis.set(`${PROPOSAL_PREFIX}${proposal.id}`, JSON.stringify(proposal));
  await context.redis.zAdd(PROPOSAL_INDEX_KEY, { member: proposal.id, score: Date.now() });
  return proposal;
}

async function listProposals(context: Devvit.Context): Promise<Proposal[]> {
  const ids = await context.redis.zRange(PROPOSAL_INDEX_KEY, 0, -1, { reverse: true, by: 'rank' });
  if (!ids || ids.length === 0) return [];
  const proposals: Proposal[] = [];
  for (const entry of ids) {
    const id = typeof entry === 'string' ? entry : entry.member;
    const raw = await context.redis.get(`${PROPOSAL_PREFIX}${id}`);
    if (raw) { try { proposals.push(JSON.parse(raw) as Proposal); } catch { /* skip */ } }
  }
  return proposals;
}

async function getProposal(context: Devvit.Context, id: string): Promise<Proposal | null> {
  const raw = await context.redis.get(`${PROPOSAL_PREFIX}${id}`);
  if (!raw) return null;
  try { return JSON.parse(raw) as Proposal; } catch { return null; }
}

async function updateProposal(context: Devvit.Context, proposal: Proposal): Promise<void> {
  await context.redis.set(`${PROPOSAL_PREFIX}${proposal.id}`, JSON.stringify(proposal));
}

// ---------------------------------------------------------------------------
// Service: CommunityPatternService
// ---------------------------------------------------------------------------

async function saveCommunityPattern(context: Devvit.Context, data: { name: string; description: string; category: string; yaml: string }, author: string): Promise<Pattern> {
  const pattern: Pattern = {
    id: generateId(), name: data.name, category: data.category,
    description: data.description, yaml: data.yaml,
    examplesCatch: [], examplesMiss: [], isBuiltIn: false, author,
  };
  await context.redis.set(`${PATTERN_PREFIX}${pattern.id}`, JSON.stringify(pattern));
  await context.redis.zAdd(PATTERN_INDEX_KEY, { member: pattern.id, score: Date.now() });
  return pattern;
}

async function listCommunityPatterns(context: Devvit.Context): Promise<Pattern[]> {
  const ids = await context.redis.zRange(PATTERN_INDEX_KEY, 0, -1, { reverse: true, by: 'rank' });
  if (!ids || ids.length === 0) return [];
  const patterns: Pattern[] = [];
  for (const entry of ids) {
    const id = typeof entry === 'string' ? entry : entry.member;
    const raw = await context.redis.get(`${PATTERN_PREFIX}${id}`);
    if (raw) { try { patterns.push(JSON.parse(raw) as Pattern); } catch { /* skip */ } }
  }
  return patterns;
}

async function deleteCommunityPattern(context: Devvit.Context, patternId: string): Promise<void> {
  await context.redis.del(`${PATTERN_PREFIX}${patternId}`);
  await context.redis.zRem(PATTERN_INDEX_KEY, [patternId]);
}

// ---------------------------------------------------------------------------
// Service: RuleDocService
// ---------------------------------------------------------------------------

async function saveRuleDoc(context: Devvit.Context, data: { ruleHash: string; description: string; addedReason: string; relatedLinks: string[] }, author: string): Promise<RuleDoc> {
  const doc: RuleDoc = { ruleHash: data.ruleHash, description: data.description, addedReason: data.addedReason, relatedLinks: data.relatedLinks, author, lastUpdated: new Date().toISOString() };
  await context.redis.set(`${RULEDOC_PREFIX}${doc.ruleHash}`, JSON.stringify(doc));
  await context.redis.zAdd(RULEDOC_INDEX_KEY, { member: doc.ruleHash, score: Date.now() });
  return doc;
}

async function listRuleDocs(context: Devvit.Context): Promise<RuleDoc[]> {
  const ids = await context.redis.zRange(RULEDOC_INDEX_KEY, 0, -1, { reverse: true, by: 'rank' });
  if (!ids || ids.length === 0) return [];
  const docs: RuleDoc[] = [];
  for (const entry of ids) {
    const id = typeof entry === 'string' ? entry : entry.member;
    const raw = await context.redis.get(`${RULEDOC_PREFIX}${id}`);
    if (raw) { try { docs.push(JSON.parse(raw) as RuleDoc); } catch { /* skip */ } }
  }
  return docs;
}

// ---------------------------------------------------------------------------
// Service: AuditService
// ---------------------------------------------------------------------------

async function recordAudit(context: Devvit.Context, type: AuditEntry['type'], author: string, detail: string, snapshotId?: string): Promise<void> {
  const entry: AuditEntry = { timestamp: new Date().toISOString(), type, author, detail, snapshotId };
  const id = generateId();
  await context.redis.set(`${AUDIT_PREFIX}${id}`, JSON.stringify(entry));
  await context.redis.zAdd(AUDIT_INDEX_KEY, { member: id, score: Date.now() });
}

async function listAuditEntries(context: Devvit.Context): Promise<AuditEntry[]> {
  const ids = await context.redis.zRange(AUDIT_INDEX_KEY, 0, -1, { reverse: true, by: 'rank' });
  if (!ids || ids.length === 0) return [];
  const entries: AuditEntry[] = [];
  for (const entry of ids) {
    const id = typeof entry === 'string' ? entry : entry.member;
    const raw = await context.redis.get(`${AUDIT_PREFIX}${id}`);
    if (raw) { try { entries.push(JSON.parse(raw) as AuditEntry); } catch { /* skip */ } }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Service: SnapshotLabelService
// ---------------------------------------------------------------------------

async function updateSnapshotLabels(context: Devvit.Context, snapshotId: string, labels: string[], isPinned: boolean, tier: SnapshotTier): Promise<Snapshot | null> {
  const snapshot = await getSnapshotById(context, snapshotId);
  if (!snapshot) return null;
  snapshot.labels = labels;
  snapshot.isPinned = isPinned;
  snapshot.tier = tier;
  await context.redis.set(`${SNAPSHOT_PREFIX}${snapshot.id}`, JSON.stringify(snapshot));
  return snapshot;
}

Devvit.addMenuItem({
  label: 'Open VigilonX – Automod Lab',
  description:
    'Open the VigilonX Automod Lab to manage AutoModerator config with version control, validation, and testing.',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const { reddit, ui } = context;
    const subreddit = await reddit.getCurrentSubreddit();
    const post = await reddit.submitPost({
      title: 'VigilonX – Automod Lab',
      subredditName: subreddit.name,
      preview: (
        <vstack height="100%" width="100%" alignment="middle center">
          <text size="large" weight="bold" color="#FF4500">
            Loading VigilonX...
          </text>
          <spacer size="medium" />
          <text size="medium">Preparing Automod Lab dashboard</text>
        </vstack>
      ),
    });
    ui.showToast({ text: 'VigilonX Automod Lab opened!' });
    ui.navigateTo(post);
  },
});

// ---------------------------------------------------------------------------
// Custom Post Type with WebView
// ---------------------------------------------------------------------------

Devvit.addCustomPostType({
  name: 'VigilonX Automod Lab',
  height: 'tall',
  render: (context) => {
    // Load initial data
    const [initialized] = useState(async () => {
      return true;
    });

    const webView = useWebView<WebViewMessage, DevvitMessage>({
      url: 'page.html',

      async onMessage(message, webView) {
        try {
          switch (message.type) {
            // ----------------------------------------------------------
            // Webview ready – send initial data bundle
            // ----------------------------------------------------------
            case 'webViewReady': {
              const subreddit = await context.reddit.getCurrentSubreddit();
              const [
                permissions, 
                { content: configYaml, revisionId: activeRevisionId }, 
                snapshots, 
                deployEvents, 
                settings, 
                lastKnownRevisionId,
                proposals,
                patterns,
                auditEntries,
                archives,
                activeLeaseRaw
              ] = await Promise.all([
                checkPermissions(context),
                getCurrentConfigWithRevision(context).catch(() => ({ content: '', revisionId: '' })),
                listSnapshots(context).catch((): Snapshot[] => []),
                listDeployEvents(context).catch((): DeployEvent[] => []),
                getSettings(context).catch(() => DEFAULT_SETTINGS),
                context.redis.get(LAST_KNOWN_REVISION_KEY).catch(() => undefined),
                listProposals(context).catch((): Proposal[] => []),
                listCommunityPatterns(context).catch((): Pattern[] => []),
                listAuditEntries(context).catch((): AuditEntry[] => []),
                listArchives(context).catch((): SnapshotArchive[] => []),
                context.redis.get(`vigilonx:lease:${subreddit.name}`)
              ]);

              // Conflict detection: only flag if we PREVIOUSLY stored a revision and it changed
              if (activeRevisionId && lastKnownRevisionId && activeRevisionId !== lastKnownRevisionId) {
                 const newSnap = await createSnapshot(context, configYaml, 'System', 'External change detected', false, 'auto', ['external-edit']);
                 snapshots.unshift(newSnap);
                 await context.redis.set(LAST_KNOWN_REVISION_KEY, activeRevisionId);
                 await recordAudit(context, 'snapshot', 'System', 'External wiki edit detected — auto-snapshot created', newSnap.id);
              } else if (activeRevisionId && !lastKnownRevisionId) {
                 // First load ever: seed the revision tracker silently
                 await context.redis.set(LAST_KNOWN_REVISION_KEY, activeRevisionId);
              }

              let activeLease: EditSessionLease | undefined = undefined;
              if (activeLeaseRaw) {
                 try { activeLease = JSON.parse(activeLeaseRaw); } catch {}
              }

              webView.postMessage({
                type: 'initialData',
                data: { 
                  config: configYaml, 
                  activeRevisionId, 
                  lastKnownRevisionId: lastKnownRevisionId || '', 
                  draft: '',
                  snapshots, 
                  deployEvents,
                  settings,
                  proposals,
                  patterns,
                  permissions,
                  auditEntries,
                  archives,
                  activeLease,
                  subredditName: subreddit.name
                },
              });
              break;
            }

            // ----------------------------------------------------------
            // Permissions
            // ----------------------------------------------------------
            case 'getPermissions': {
              const permissions = await checkPermissions(context);
              webView.postMessage({
                type: 'permissionsResult',
                data: permissions,
              });
              break;
            }

            // ----------------------------------------------------------
            // Active config
            // ----------------------------------------------------------
            case 'getActiveConfig': {
              const { content: configYaml, revisionId } = await getCurrentConfigWithRevision(context);
              webView.postMessage({
                type: 'activeConfigResult',
                data: { configYaml, revisionId },
              });
              break;
            }

            // ----------------------------------------------------------
            // Snapshots
            // ----------------------------------------------------------
            case 'listSnapshots': {
              const snapshots = await listSnapshots(context);
              webView.postMessage({
                type: 'snapshotListResult',
                data: { snapshots },
              });
              break;
            }

            case 'getSnapshot': {
              const snapshot = await getSnapshotById(
                context,
                message.data.snapshotId
              );
              webView.postMessage({
                type: 'snapshotResult',
                data: { snapshot },
              });
              break;
            }

            case 'createSnapshot': {
              const permissions = await checkPermissions(context);
              if (!permissions.canView) {
                webView.postMessage({
                  type: 'error',
                  data: {
                    message: 'You do not have permission to create snapshots.',
                    context: 'createSnapshot',
                  },
                });
                break;
              }

              const currentConfig = await getCurrentConfig(context);
              const snapshot = await createSnapshot(
                context,
                currentConfig,
                permissions.username,
                message.data.note || 'Manual snapshot',
                false,
                message.data.tier || 'manual',
                message.data.labels || []
              );
              await recordAudit(context, 'snapshot', permissions.username, `Snapshot created: ${snapshot.id}`, snapshot.id);

              webView.postMessage({
                type: 'snapshotCreated',
                data: { snapshot },
              });
              break;
            }

            // ----------------------------------------------------------
            // Rollback
            // ----------------------------------------------------------
            case 'rollbackToSnapshot': {
              const perms = await checkPermissions(context);
              if (!perms.canEdit) {
                webView.postMessage({
                  type: 'error',
                  data: {
                    message:
                      'You do not have permission to modify the Automod config.',
                    context: 'rollback',
                  },
                });
                break;
              }

              // Check operational mode
              const rollbackSettings = await getSettings(context);
              if (rollbackSettings.operatingMode === 'safe') {
                webView.postMessage({ type: 'error', data: { message: 'Cannot rollback in Safe Mode. Switch to Standard or Power mode first.', context: 'rollback' } });
                break;
              }
              if (rollbackSettings.configFreeze) {
                webView.postMessage({ type: 'error', data: { message: 'Config Freeze is active. Disable it in Settings before rolling back.', context: 'rollback' } });
                break;
              }

              const targetSnapshot = await getSnapshotById(
                context,
                message.data.snapshotId
              );
              if (!targetSnapshot) {
                webView.postMessage({
                  type: 'error',
                  data: {
                    message: 'Snapshot not found.',
                    context: 'rollback',
                  },
                });
                break;
              }

              // 1. Snapshot current live config before rollback
              const currentConfigBeforeRollback =
                await getCurrentConfig(context);
              const preRollbackSnapshot = await createSnapshot(
                context,
                currentConfigBeforeRollback,
                perms.username,
                `Auto-snapshot before rollback to ${targetSnapshot.id}`,
                false,
                'auto'
              );

              // 2. Apply the target snapshot's config
              await setConfig(
                context,
                targetSnapshot.configYaml,
                `Rollback to snapshot ${targetSnapshot.id}`
              );

              // 3. Mark new active
              await markSnapshotActive(context, targetSnapshot.id);

              // 4. Record deploy event + audit trail
              await recordDeployEvent(
                context,
                perms.username,
                preRollbackSnapshot.id,
                targetSnapshot.id,
                message.data.note || `Rollback to ${targetSnapshot.id}`
              );
              await recordAudit(context, 'rollback', perms.username, `Rolled back to snapshot ${targetSnapshot.id}`, targetSnapshot.id);

              webView.postMessage({
                type: 'rollbackComplete',
                data: {
                  snapshot: targetSnapshot,
                  newActiveConfig: targetSnapshot.configYaml,
                },
              });
              break;
            }

            // ----------------------------------------------------------
            // Deploy draft
            // ----------------------------------------------------------
            case 'deployDraft': {
              const deployPerms = await checkPermissions(context);
              if (!deployPerms.canEdit) {
                webView.postMessage({
                  type: 'error',
                  data: {
                    message:
                      'You do not have permission to deploy Automod configs.',
                    context: 'deploy',
                  },
                });
                break;
              }

              const settings = await getSettings(context);
              if (settings.operatingMode === 'safe') {
                webView.postMessage({
                  type: 'error',
                  data: {
                    message: 'Cannot deploy to live config while in Safe Mode. Switch to Standard or Power mode in Settings.',
                    context: 'deploy',
                  },
                });
                break;
              }

              if (settings.configFreeze) {
                webView.postMessage({
                  type: 'error',
                  data: {
                    message: 'Config Freeze is active. All live deployments are locked. Disable the freeze in Settings before deploying.',
                    context: 'deploy',
                  },
                });
                break;
              }

              const deployLock = await acquireDeployLock(context, deployPerms.username);
              if (!deployLock) {
                webView.postMessage({ type: 'error', data: { message: 'Another deployment is in progress. Please wait a moment and try again.', context: 'deploy' } });
                break;
              }

              try {
              const { content: liveConfig, revisionId: liveRevisionId } = await getCurrentConfigWithRevision(context);
              const lastKnownRevisionId = await context.redis.get(LAST_KNOWN_REVISION_KEY);
              
              if (liveRevisionId && lastKnownRevisionId && liveRevisionId !== lastKnownRevisionId) {
                webView.postMessage({
                  type: 'error',
                  data: {
                    message: 'Conflict Detected: The live AutoModerator config was edited externally. Please review the external changes in the Versions tab before deploying.',
                    context: 'deploy',
                  },
                });
                break;
              }

              let previousSnapshotId: string | null = null;
              if (liveConfig.trim()) {
                const preDeploySnapshot = await createSnapshot(
                  context,
                  liveConfig,
                  'System',
                  'Auto-snapshot before deploy',
                  false,
                  'auto'
                );
                previousSnapshotId = preDeploySnapshot.id;
              }

              // 2. Write the new config
              await setConfig(
                context,
                message.data.configYaml,
                message.data.note || 'Deploy via VigilonX'
              );

              // 3. Create snapshot of the newly deployed config
              const newSnapshot = await createSnapshot(
                context,
                message.data.configYaml,
                deployPerms.username,
                message.data.note || 'Deployed via VigilonX',
                true // Mark as active
              );
              await markSnapshotActive(context, newSnapshot.id);

              // 4. Record deploy event + audit
              const deployEvent = await recordDeployEvent(
                context,
                deployPerms.username,
                previousSnapshotId,
                newSnapshot.id,
                message.data.note || 'Deploy via VigilonX'
              );
              await recordAudit(context, 'deploy', deployPerms.username, `Deployed config: ${(message.data.note || 'via VigilonX').substring(0, 80)}`, newSnapshot.id);

              webView.postMessage({
                type: 'deployComplete',
                data: { snapshot: newSnapshot, deployEvent },
              });
              } finally {
                await releaseDeployLock(context, deployLock);
              }
              break;
            }

            case 'forceOverwriteConfig': {
              const deployPerms = await checkPermissions(context);
              if (!deployPerms.canEdit) {
                webView.postMessage({ type: 'error', data: { message: 'No permission.', context: 'deploy' } });
                break;
              }
              const settings = await getSettings(context);
              if (settings.operatingMode === 'safe') {
                webView.postMessage({ type: 'error', data: { message: 'Cannot overwrite in Safe Mode.', context: 'deploy' } });
                break;
              }
              const forceLock = await acquireDeployLock(context, deployPerms.username);
              if (!forceLock) {
                webView.postMessage({ type: 'error', data: { message: 'Another deployment is in progress. Please wait a moment and try again.', context: 'deploy' } });
                break;
              }
              try {
              // Force update
              await setConfig(context, message.data.configYaml, message.data.note || 'Forced overwrite via VigilonX');
              const newSnapshot = await createSnapshot(context, message.data.configYaml, deployPerms.username, message.data.note || 'Forced overwrite', true);
              await markSnapshotActive(context, newSnapshot.id);
              await recordDeployEvent(context, deployPerms.username, null, newSnapshot.id, 'Forced overwrite');
              
              webView.postMessage({
                type: 'deployComplete',
                data: { snapshot: newSnapshot, deployEvent: { id: generateId(), timestamp: new Date().toISOString(), author: deployPerms.username, previousSnapshotId: null, newSnapshotId: newSnapshot.id, note: 'Forced overwrite' } },
              });
              } finally {
                await releaseDeployLock(context, forceLock);
              }
              break;
            }

            case 'pullExternalConfig': {
              const { content, revisionId } = await getCurrentConfigWithRevision(context);
              if (revisionId === message.data.revisionId) {
                await context.redis.set(LAST_KNOWN_REVISION_KEY, revisionId);
              }
              webView.postMessage({
                type: 'activeConfigResult',
                data: { configYaml: content, revisionId },
              });
              break;
            }

            // ----------------------------------------------------------
            // Deploy events
            // ----------------------------------------------------------
            case 'listDeployEvents': {
              const events = await listDeployEvents(context);
              webView.postMessage({
                type: 'deployEventsResult',
                data: { deployEvents: events },
              });
              break;
            }

            // ----------------------------------------------------------
            // Sample recent posts (optional feature)
            // ----------------------------------------------------------
            case 'sampleRecentPosts': {
              try {
                const subreddit =
                  await context.reddit.getCurrentSubreddit();
                const posts = await context.reddit.getNewPosts({
                  subredditName: subreddit.name,
                  limit: Math.min(message.data.count, 20),
                });

                const sampled: Array<{
                  title: string;
                  body: string;
                  domain: string;
                  authorName: string;
                }> = [];

                for await (const post of posts) {
                  sampled.push({
                    title: post.title || '',
                    body: post.body || '',
                    domain: post.url
                      ? new URL(post.url).hostname
                      : 'self',
                    authorName: post.authorName || 'unknown',
                  });
                  if (sampled.length >= message.data.count) break;
                }

                webView.postMessage({
                  type: 'recentPostsResult',
                  data: { posts: sampled },
                });
              } catch (err: unknown) {
                webView.postMessage({
                  type: 'error',
                  data: {
                    message: `Failed to fetch recent posts: ${err instanceof Error ? err.message : String(err)}`,
                    context: 'sampleRecentPosts',
                  },
                });
              }
              break;
            }

            // ----------------------------------------------------------
            // Snapshot labels
            // ----------------------------------------------------------
            case 'updateSnapshotLabels': {
              const snap = await updateSnapshotLabels(context, message.data.snapshotId, message.data.labels, message.data.isPinned, message.data.tier);
              if (snap) webView.postMessage({ type: 'snapshotUpdated', data: { snapshot: snap } });
              else webView.postMessage({ type: 'error', data: { message: 'Snapshot not found.', context: 'updateSnapshotLabels' } });
              break;
            }

            // ----------------------------------------------------------
            // Settings
            // ----------------------------------------------------------
            case 'getSettings': {
              const s = await getSettings(context);
              webView.postMessage({ type: 'settingsResult', data: { settings: s } });
              break;
            }
            case 'updateSettings': {
              const perms2 = await checkPermissions(context);
              if (!perms2.canEdit) { webView.postMessage({ type: 'error', data: { message: 'No permission to change settings.', context: 'updateSettings' } }); break; }
              await saveSettings(context, message.data.settings);
              await recordAudit(context, 'setting_change', perms2.username, 'Settings updated');
              webView.postMessage({ type: 'settingsUpdated', data: { settings: message.data.settings } });
              break;
            }

            // ----------------------------------------------------------
            // Proposals
            // ----------------------------------------------------------
            case 'listProposals': {
              const proposals = await listProposals(context);
              webView.postMessage({ type: 'proposalListResult', data: { proposals } });
              break;
            }
            case 'createProposal': {
              const pPerms = await checkPermissions(context);
              if (!pPerms.canView) { webView.postMessage({ type: 'error', data: { message: 'No permission.', context: 'createProposal' } }); break; }
              const proposal = await createProposal(context, message.data, pPerms.username);
              await recordAudit(context, 'proposal', pPerms.username, `Proposal created: ${proposal.title}`);
              webView.postMessage({ type: 'proposalCreated', data: { proposal } });
              break;
            }
            case 'approveProposal': {
              const aPerms = await checkPermissions(context);
              if (!aPerms.canEdit) { webView.postMessage({ type: 'error', data: { message: 'No permission.', context: 'approveProposal' } }); break; }
              const ap = await getProposal(context, message.data.proposalId);
              if (!ap) { webView.postMessage({ type: 'error', data: { message: 'Proposal not found.', context: 'approveProposal' } }); break; }
              if (!ap.approvals.includes(aPerms.username)) ap.approvals.push(aPerms.username);
              const stg = await getSettings(context);
              if (stg.requireApprovals && ap.approvals.length >= stg.requiredApprovalCount) ap.status = 'approved';
              else if (!stg.requireApprovals) ap.status = 'approved';
              await updateProposal(context, ap);
              webView.postMessage({ type: 'proposalUpdated', data: { proposal: ap } });
              break;
            }
            case 'rejectProposal': {
              const rPerms = await checkPermissions(context);
              if (!rPerms.canEdit) { webView.postMessage({ type: 'error', data: { message: 'No permission.', context: 'rejectProposal' } }); break; }
              const rp = await getProposal(context, message.data.proposalId);
              if (!rp) { webView.postMessage({ type: 'error', data: { message: 'Proposal not found.', context: 'rejectProposal' } }); break; }
              rp.status = 'rejected';
              await updateProposal(context, rp);
              webView.postMessage({ type: 'proposalUpdated', data: { proposal: rp } });
              break;
            }
            case 'addProposalComment': {
              const cPerms = await checkPermissions(context);
              if (!cPerms.canView) { webView.postMessage({ type: 'error', data: { message: 'No permission.', context: 'addProposalComment' } }); break; }
              const cp = await getProposal(context, message.data.proposalId);
              if (!cp) { webView.postMessage({ type: 'error', data: { message: 'Proposal not found.', context: 'addProposalComment' } }); break; }
              cp.comments.push({ id: generateId(), author: cPerms.username, timestamp: new Date().toISOString(), text: message.data.text });
              await updateProposal(context, cp);
              webView.postMessage({ type: 'proposalUpdated', data: { proposal: cp } });
              break;
            }
            case 'deployProposal': {
              const dpPerms = await checkPermissions(context);
              if (!dpPerms.canEdit) { webView.postMessage({ type: 'error', data: { message: 'No permission.', context: 'deployProposal' } }); break; }
              const dp = await getProposal(context, message.data.proposalId);
              if (!dp) { webView.postMessage({ type: 'error', data: { message: 'Proposal not found.', context: 'deployProposal' } }); break; }
              const stgs = await getSettings(context);
              if (stgs.requireApprovals && dp.approvals.length < stgs.requiredApprovalCount) {
                webView.postMessage({ type: 'error', data: { message: `Needs ${stgs.requiredApprovalCount} approval(s), has ${dp.approvals.length}.`, context: 'deployProposal' } }); break;
              }
              const proposalLock = await acquireDeployLock(context, dpPerms.username);
              if (!proposalLock) {
                webView.postMessage({ type: 'error', data: { message: 'Another deployment is in progress. Please wait a moment and try again.', context: 'deployProposal' } });
                break;
              }
              try {
              // Deploy the proposal config
              const { content: liveConfig2, revisionId: liveRevisionId2 } = await getCurrentConfigWithRevision(context);
              const lastKnownRevisionId2 = await context.redis.get(LAST_KNOWN_REVISION_KEY);
              if (liveRevisionId2 && lastKnownRevisionId2 && liveRevisionId2 !== lastKnownRevisionId2) {
                webView.postMessage({
                  type: 'error',
                  data: {
                    message: 'Conflict Detected: The live AutoModerator config was edited externally. Please review the external changes in the Versions tab before deploying this proposal.',
                    context: 'deployProposal',
                  },
                });
                break;
              }
              let prevSnapId2: string | null = null;
              if (liveConfig2.trim()) {
                const preDeploy = await createSnapshot(context, liveConfig2, dpPerms.username, 'Auto-snapshot before proposal deploy', false, 'auto');
                prevSnapId2 = preDeploy.id;
              }
              await setConfig(context, dp.configYaml, `Proposal deploy: ${dp.title}`);
              const newSnap2 = await createSnapshot(context, dp.configYaml, dpPerms.username, `Proposal: ${dp.title}`, true, 'manual');
              await markSnapshotActive(context, newSnap2.id);
              const de2 = await recordDeployEvent(context, dpPerms.username, prevSnapId2, newSnap2.id, `Proposal: ${dp.title}`);
              dp.status = 'deployed';
              await updateProposal(context, dp);
              await recordAudit(context, 'deploy', dpPerms.username, `Proposal deployed: ${dp.title}`, newSnap2.id);
              webView.postMessage({ type: 'deployComplete', data: { snapshot: newSnap2, deployEvent: de2 } });
              } finally {
                await releaseDeployLock(context, proposalLock);
              }
              break;
            }

            // ----------------------------------------------------------
            // Community Patterns
            // ----------------------------------------------------------
            case 'listCommunityPatterns': {
              const patterns = await listCommunityPatterns(context);
              webView.postMessage({ type: 'communityPatternsResult', data: { patterns } });
              break;
            }
            case 'saveCommunityPattern': {
              const cpPerms = await checkPermissions(context);
              if (!cpPerms.canView) { webView.postMessage({ type: 'error', data: { message: 'No permission.', context: 'saveCommunityPattern' } }); break; }
              const pat = await saveCommunityPattern(context, message.data, cpPerms.username);
              webView.postMessage({ type: 'communityPatternSaved', data: { pattern: pat } });
              break;
            }
            case 'deleteCommunityPattern': {
              const dcPerms = await checkPermissions(context);
              if (!dcPerms.canEdit) { webView.postMessage({ type: 'error', data: { message: 'No permission.', context: 'deleteCommunityPattern' } }); break; }
              await deleteCommunityPattern(context, message.data.patternId);
              webView.postMessage({ type: 'communityPatternDeleted', data: { patternId: message.data.patternId } });
              break;
            }

            // ----------------------------------------------------------
            // Rule Docs
            // ----------------------------------------------------------
            case 'getRuleDocs': {
              const docs = await listRuleDocs(context);
              webView.postMessage({ type: 'ruleDocsResult', data: { docs } });
              break;
            }
            case 'saveRuleDoc': {
              const rdPerms = await checkPermissions(context);
              if (!rdPerms.canView) { webView.postMessage({ type: 'error', data: { message: 'No permission.', context: 'saveRuleDoc' } }); break; }
              const doc = await saveRuleDoc(context, message.data, rdPerms.username);
              webView.postMessage({ type: 'ruleDocSaved', data: { doc } });
              break;
            }

            // ----------------------------------------------------------
            // Audit Trail Export
            // ----------------------------------------------------------
            case 'exportAuditTrail': {
              const entries = await listAuditEntries(context);
              webView.postMessage({ type: 'auditTrailResult', data: { entries } });
              break;
            }

            // ----------------------------------------------------------
            // Edit Session Leasing
            // ----------------------------------------------------------
            case 'pingLease': {
              const user = await context.reddit.getCurrentUser();
              if (user) {
                const subreddit = await context.reddit.getCurrentSubreddit();
                const lease: EditSessionLease = {
                  subredditName: subreddit.name,
                  user: user.username,
                  startTime: Date.now(),
                  baseRevisionId: message.data.baseRevisionId
                };
                await context.redis.set(`vigilonx:lease:${subreddit.name}`, JSON.stringify(lease), { expiration: new Date(Date.now() + 15 * 60 * 1000) });
              }
              break;
            }

            case 'breakLease': {
              const subreddit = await context.reddit.getCurrentSubreddit();
              const user = await context.reddit.getCurrentUser();
              const leaseKey = `vigilonx:lease:${subreddit.name}`;
              const rawLease = await context.redis.get(leaseKey).catch(() => undefined);
              if (user && rawLease) {
                try {
                  const lease = JSON.parse(rawLease) as EditSessionLease;
                  if (lease.user === user.username) {
                    await context.redis.del(leaseKey);
                  }
                } catch {
                  await context.redis.del(leaseKey);
                }
              }
              break;
            }

            // ----------------------------------------------------------
            // Emergency Brake
            // ----------------------------------------------------------
            case 'emergencyBrake': {
              const brakePerms = await checkPermissions(context);
              if (!brakePerms.canEdit) {
                webView.postMessage({ type: 'error', data: { message: 'No permission to pull emergency brake.', context: 'emergencyBrake' } });
                break;
              }
              
              // 1. Set config freeze
              const brakeSettings = await getSettings(context);
              brakeSettings.configFreeze = true;
              await context.redis.set(SETTINGS_KEY, JSON.stringify(brakeSettings));
              
              // 2. Find last stable snapshot (milestone > manual > previous non-active)
              const allSnaps = await listSnapshots(context);
              const activeSnapshotId = await context.redis.get(ACTIVE_SNAPSHOT_KEY).catch(() => undefined);
              const rollbackCandidates = allSnaps.filter(s => s.id !== activeSnapshotId && !s.isActive);
              const lastStable =
                rollbackCandidates.find(s => s.tier === 'milestone') ||
                rollbackCandidates.find(s => s.tier === 'manual') ||
                rollbackCandidates[0];
              
              if (lastStable) {
                const currentLive = await getCurrentConfig(context).catch(() => '');
                await createSnapshot(context, currentLive, brakePerms.username, 'Auto-snapshot before Emergency Brake', false, 'auto', ['pre-brake']);
                await setConfig(context, lastStable.configYaml, 'EMERGENCY BRAKE ROLLBACK', true);
                await markSnapshotActive(context, lastStable.id);
                await recordAudit(context, 'rollback', brakePerms.username, `Emergency Brake deployed. Rolled back to ${lastStable.id}`, lastStable.id);
                
                const brakeSubreddit = await context.reddit.getCurrentSubreddit();
                const [updatedSnapshots, updatedDeployEvents, updatedProposals, updatedPatterns, updatedAudit, updatedArchives] = await Promise.all([
                  listSnapshots(context).catch((): Snapshot[] => []),
                  listDeployEvents(context).catch((): DeployEvent[] => []),
                  listProposals(context).catch((): Proposal[] => []),
                  listCommunityPatterns(context).catch((): Pattern[] => []),
                  listAuditEntries(context).catch((): AuditEntry[] => []),
                  listArchives(context).catch((): SnapshotArchive[] => []),
                ]);
                
                webView.postMessage({ type: 'initialData', data: { 
                  config: lastStable.configYaml, 
                  activeRevisionId: '', 
                  lastKnownRevisionId: '', 
                  draft: '',
                  snapshots: updatedSnapshots, 
                  deployEvents: updatedDeployEvents,
                  settings: brakeSettings,
                  proposals: updatedProposals,
                  patterns: updatedPatterns,
                  permissions: brakePerms,
                  auditEntries: updatedAudit,
                  archives: updatedArchives,
                  subredditName: brakeSubreddit.name
                } });
              } else {
                const message = allSnaps.length === 1
                  ? 'Only the current active snapshot exists. Emergency Brake enabled Config Freeze, but there is no earlier stable snapshot to rollback to.'
                  : 'No stable snapshot exists to rollback to. Take a manual or milestone snapshot of a known-good config first.';
                webView.postMessage({ type: 'error', data: { message, context: 'emergencyBrake' } });
              }
              break;
            }

            // ----------------------------------------------------------
            // Dry-run deploy
            // ----------------------------------------------------------
            case 'confirmStagedDeploy': {
              const csPerms = await checkPermissions(context);
              if (!csPerms.canEdit) { webView.postMessage({ type: 'error', data: { message: 'No permission.', context: 'confirmStagedDeploy' } }); break; }
              webView.postMessage({ type: 'toast', data: { message: 'Staged deploy confirmed as stable.' } });
              break;
            }

            default:
              console.warn(`VigilonX: Unknown message type: ${(message as { type: string }).type}`);
          }
        } catch (err: unknown) {
          const errorMessage =
            err instanceof Error ? err.message : String(err);
          console.error(`VigilonX error: ${errorMessage}`);
          webView.postMessage({
            type: 'error',
            data: { message: errorMessage, context: 'unknown' },
          });
        }
      },

      onUnmount() {
        context.ui.showToast('VigilonX session closed.');
      },
    });

    return (
      <vstack grow padding="medium">
        <vstack grow alignment="middle center">
          <text size="xlarge" weight="bold">
            VigilonX
          </text>
          <spacer size="xsmall" />
          <text size="small" color="neutral-content-weak">
            Automod Configuration Lab
          </text>
          <spacer size="medium" />
          <hstack gap="small" alignment="middle center">
            <vstack padding="small" cornerRadius="small" backgroundColor="neutral-background-hover">
              <text size="small" weight="bold">Versions</text>
              <text size="xsmall" color="neutral-content-weak">Snapshot &amp; rollback</text>
            </vstack>
            <vstack padding="small" cornerRadius="small" backgroundColor="neutral-background-hover">
              <text size="small" weight="bold">Validate</text>
              <text size="xsmall" color="neutral-content-weak">Syntax &amp; rule checks</text>
            </vstack>
          </hstack>
          <spacer size="small" />
          <hstack gap="small" alignment="middle center">
            <vstack padding="small" cornerRadius="small" backgroundColor="neutral-background-hover">
              <text size="small" weight="bold">Test</text>
              <text size="xsmall" color="neutral-content-weak">Simulate rule matches</text>
            </vstack>
            <vstack padding="small" cornerRadius="small" backgroundColor="neutral-background-hover">
              <text size="small" weight="bold">Deploy</text>
              <text size="xsmall" color="neutral-content-weak">Safe config updates</text>
            </vstack>
          </hstack>
          <spacer size="large" />
          <button appearance="primary" onPress={() => webView.mount()}>
            Open Automod Lab
          </button>
          <spacer size="small" />
          <text size="xsmall" color="neutral-content-weak">
            Safe change management for your subreddit
          </text>
        </vstack>
      </vstack>
    );
  },
});

export default Devvit;
