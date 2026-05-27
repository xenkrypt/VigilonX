/**
 * VigilonX – Main App Controller
 * Wires the webview UI to Devvit server via postMessage.
 */

class VigilonXApp {
  constructor() {
    this.permissions = { canView: false, canEdit: false, username: 'unknown' };
    this.activeConfig = '';
    this.snapshots = [];
    this.deployEvents = [];
    this.settings = {};
    this.proposals = [];
    this.communityPatterns = [];
    this.auditEntries = [];

    this.currentDraftYaml = '';
    this.lastValidation = null;
    this.lastDeepValidation = null;
    this.hasRunTests = false;
    this.pendingRollbackId = null;
    this.viewingSnapshot = null;
    this.draftBaseSnapshotId = null;
    this.draftIsDirty = false;
    this.leaseInterval = null;
    this.activeMission = null;
    this.subredditName = ''; // Populated from initialData, used to namespace localStorage

    // AI Assistance (session-only state)
    this.aiEnabled = false;
    this.aiEnabled = false;
    this.aiApiKey = '';
    this.aiModel = 'gemini-2.5-flash';
    this.aiLoading = false;

    this.bindTheme();
    this.bindTabs();
    this.bindVersionsTab();
    this.bindDraftTab();
    this.bindTesterTab();
    this.bindModals();
    this.bindSettingsTab();
    this.bindProposalsTab();
    this.bindHealthTab();
    this.bindPatternsTab();
    this.bindEmergencyBrake();
    this.bindDelegatedActions();
    this.bindAIAssist();

    addEventListener('message', (ev) => this.onMessage(ev));
    addEventListener('load', () => this.send({ type: 'webViewReady' }));

    // Lease cleanup on page unload — prevents leaked intervals and stale locks
    const releaseLease = () => this.releaseLease();
    addEventListener('beforeunload', releaseLease);
    addEventListener('pagehide', releaseLease);
  }

  send(msg) { parent.postMessage(msg, '*'); }

  releaseLease() {
    if (!this.leaseInterval) return;
    clearInterval(this.leaseInterval);
    this.leaseInterval = null;
    this.send({ type: 'breakLease', data: {} });
  }

  bindDelegatedActions() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      switch (btn.dataset.action) {
        case 'view-snapshot':
          this.viewSnapshot(id);
          break;
        case 'rollback-snapshot':
          this.promptRollback(id);
          break;
        case 'approve-proposal':
          this.approveProposal(id);
          break;
        case 'deploy-proposal':
          this.deployProposal(id);
          break;
        case 'reject-proposal':
          this.rejectProposal(id);
          break;
        case 'view-proposal-diff':
          this.viewProposalDiff(id);
          break;
        case 'open-pattern':
          this.openPatternWizard(id);
          break;
        case 'delete-pattern':
          this.deletePattern(id);
          break;
        case 'start-mission':
          this.startMission(id);
          break;
        case 'dismiss-banner':
          btn.closest('.system-banner, .conflict-banner')?.remove();
          break;
      }
    });
  }

  // ---- Theme ----
  bindTheme() {
    const btn = document.getElementById('btn-theme');
    const saved = localStorage.getItem('vigilonx-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    this.updateThemeIcon(saved);
    if (btn) {
      btn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('vigilonx-theme', next);
        this.updateThemeIcon(next);
      });
    }
  }

  updateThemeIcon(theme) {
    const moon = document.getElementById('icon-moon');
    const sun = document.getElementById('icon-sun');
    if (moon) moon.style.display = theme === 'dark' ? 'block' : 'none';
    if (sun) sun.style.display = theme === 'light' ? 'block' : 'none';
  }

  // ---- Messages ----
  onMessage(ev) {
    if (ev.data.type !== 'devvit-message') return;
    const msg = ev.data.data.message;
    switch (msg.type) {
      case 'initialData':
        this.permissions = msg.data.permissions || this.permissions;
        this.activeConfig = msg.data.config || '';
        this.snapshots = msg.data.snapshots || [];
        this.deployEvents = msg.data.deployEvents || [];
        this.settings = msg.data.settings || {};
        this.proposals = msg.data.proposals || [];
        this.communityPatterns = msg.data.patterns || [];
        this.auditEntries = msg.data.auditEntries || [];
        this.archives = msg.data.archives || [];
        this.activeLease = msg.data.activeLease;
        this.lastKnownRevisionId = msg.data.lastKnownRevisionId || '';
        this.activeRevisionId = msg.data.activeRevisionId || '';
        this.subredditName = msg.data.subredditName || '';

        this.updateStatus('connected');
        this.renderAll();
        this.checkDraftRecovery();
        
        // Fetch deploy events separately since initialData may not include them
        if (!this.deployEvents.length) {
          this.send({ type: 'listDeployEvents' });
        }
        
        // Handle Lease Warning if activeLease belongs to someone else
        if (this.activeLease && this.activeLease.user !== this.permissions.username) {
           this.showLeaseWarning();
        }
        
        break;
      case 'activeConfigResult':
        this.activeConfig = msg.data.configYaml;
        this.renderActiveConfig();
        this.renderHealth(); // Update health if viewing active config
        break;
      case 'snapshotListResult':
        this.snapshots = msg.data.snapshots;
        this.renderSnapshots();
        this.populateSnapshotDropdown();
        break;
      case 'snapshotCreated':
        this.snapshots.unshift(msg.data.snapshot);
        this.renderSnapshots();
        this.populateSnapshotDropdown();
        this.toast('Snapshot created');
        this.closeModals();
        break;
      case 'snapshotUpdated':
        const i = this.snapshots.findIndex(s => s.id === msg.data.snapshot.id);
        if (i !== -1) {
          this.snapshots[i] = msg.data.snapshot;
          this.renderSnapshots();
        }
        break;
      case 'rollbackComplete':
        this.activeConfig = msg.data.newActiveConfig;
        this.renderActiveConfig();
        this.send({ type: 'listSnapshots' });
        this.send({ type: 'listDeployEvents' });
        this.toast('Rollback complete');
        this.closeModals();
        break;
      case 'deployComplete':
        this.activeConfig = msg.data.snapshot.configYaml;
        this.snapshots.unshift(msg.data.snapshot);
        this.deployEvents.unshift(msg.data.deployEvent);
        this.renderAll();
        this.toast('Deploy successful');
        this.closeModals();
        this.clearLocalDraft();
        break;
      case 'deployEventsResult':
        this.deployEvents = msg.data.deployEvents;
        this.renderDeployEvents();
        break;
      
      // Expanded features messages
      case 'settingsResult':
      case 'settingsUpdated':
        this.settings = msg.data.settings;
        this.renderSettings();
        if (msg.type === 'settingsUpdated') this.toast('Settings saved');
        break;
      
      case 'proposalListResult':
        this.proposals = msg.data.proposals;
        this.renderProposals();
        break;
      case 'proposalCreated':
        this.proposals.unshift(msg.data.proposal);
        this.renderProposals();
        this.toast('Proposal created');
        this.closeModals();
        break;
      case 'proposalUpdated':
        const pi = this.proposals.findIndex(p => p.id === msg.data.proposal.id);
        if (pi !== -1) {
          this.proposals[pi] = msg.data.proposal;
          this.renderProposals();
        }
        break;
        
      case 'auditTrailResult':
        this.auditEntries = msg.data.entries;
        this.renderAudit();
        break;

      case 'communityPatternsResult':
        this.communityPatterns = msg.data.patterns || [];
        this.renderPatterns();
        break;
      case 'communityPatternSaved':
        this.communityPatterns.unshift(msg.data.pattern);
        this.renderPatterns();
        this.toast('Pattern saved');
        break;
      case 'communityPatternDeleted':
        this.communityPatterns = this.communityPatterns.filter(p => p.id !== msg.data.patternId);
        this.renderPatterns();
        this.toast('Pattern deleted');
        break;

      case 'error':
        this.toast('Error: ' + msg.data.message, true);
        this.closeModals();
        break;
      case 'toast':
        this.toast(msg.data.message);
        break;

      // AI Assistance responses
      case 'aiGenerateResult':
        this.aiLoading = false;
        this.updateAIButtons();
        if (msg.data.success) {
          const editor = document.getElementById('yaml-editor');
          const existing = editor.value.trim();
          editor.value = existing ? existing + '\n\n' + msg.data.yaml : msg.data.yaml;
          this.currentDraftYaml = editor.value;
          this.updateDraftInfo();
          this.runValidation(true);
          this.toast('AI rule generated — review and validate before deploying');
          document.getElementById('ai-error-output').style.display = 'none';
          document.getElementById('ai-explain-output').style.display = 'none';
        } else {
          document.getElementById('ai-error-output').textContent = msg.data.error || 'Generation failed';
          document.getElementById('ai-error-output').style.display = 'block';
        }
        break;

      case 'aiExplainResult':
        this.aiLoading = false;
        this.updateAIButtons();
        if (msg.data.success) {
          const output = document.getElementById('ai-explain-output');
          output.textContent = msg.data.explanation;
          output.style.display = 'block';
          document.getElementById('ai-error-output').style.display = 'none';
        } else {
          document.getElementById('ai-error-output').textContent = msg.data.error || 'Explanation failed';
          document.getElementById('ai-error-output').style.display = 'block';
        }
        break;
    }
  }

  // ---- Tabs ----
  bindTabs() {
    document.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
        
        // Trigger specific renders on tab switch
        if (btn.dataset.tab === 'health') {
          this.renderHealth();
        } else if (btn.dataset.tab === 'patterns') {
          this.renderPatterns();
          this.renderTraining();
        }

        // Clear training mission state if navigating away from draft
        if (btn.dataset.tab !== 'draft' && this.activeMission) {
          this.activeMission = null;
          this.updateTrainingIndicator();
        }
      });
    });
  }

  // ---- Versions ----
  bindVersionsTab() {
    document.getElementById('btn-snapshot-now').addEventListener('click', () => {
      document.getElementById('modal-snapshot-note').classList.add('active');
    });
    document.getElementById('btn-copy-active').addEventListener('click', () => {
      if (navigator.clipboard) { navigator.clipboard.writeText(this.activeConfig); this.toast('Copied'); }
    });
    document.getElementById('btn-load-into-draft').addEventListener('click', () => {
      document.getElementById('yaml-editor').value = this.activeConfig;
      this.currentDraftYaml = this.activeConfig;
      this.updateDraftInfo();
      document.getElementById('draft-source-label').textContent = 'From active config';
      document.querySelector('[data-tab="draft"]').click();
    });
    document.getElementById('btn-sync-external')?.addEventListener('click', () => {
      this.send({ type: 'pullExternalConfig', data: { revisionId: this.activeRevisionId } });
    });

    const btnForceSync = document.getElementById('btn-force-sync');
    if (btnForceSync) {
      btnForceSync.addEventListener('click', () => {
        document.getElementById('conflict-banner').style.display = 'none';
        this.lastKnownRevisionId = this.activeRevisionId;
      });
    }

    const btnPullDiff = document.getElementById('btn-pull-diff');
    if (btnPullDiff) {
      btnPullDiff.addEventListener('click', () => {
        document.getElementById('conflict-banner').style.display = 'none';
        this.lastKnownRevisionId = this.activeRevisionId;
        
        // Find the external-edit snapshot
        const snap = this.snapshots.find(s => (s.labels || []).includes('external-edit'));
        if (snap) {
          this.viewSnapshot(snap.id);
        }
      });
    }
  }

  renderActiveConfig() {
    const el = document.getElementById('active-config-preview');
    el.textContent = this.activeConfig.trim()
      ? this.activeConfig.substring(0, 400) + (this.activeConfig.length > 400 ? '\n…' : '')
      : '(No AutoModerator config found)';
      
    const banner = document.getElementById('conflict-banner');
    if (this.activeRevisionId && this.lastKnownRevisionId && this.activeRevisionId !== this.lastKnownRevisionId) {
      banner.style.display = 'block';
    } else {
      banner.style.display = 'none';
    }
  }

  renderSnapshots() {
    const c = document.getElementById('snapshot-list');
    if (!this.snapshots.length) {
      c.innerHTML = '<div class="empty"><span class="title">No snapshots</span><span class="desc">Take a snapshot to start tracking</span></div>';
      return;
    }
    c.innerHTML = this.snapshots.map(s => {
      let badges = '';
      if (s.isActive) badges += '<span class="badge badge-green" style="font-size:10px;">ACTIVE</span> ';
      if (s.tier === 'milestone' || s.isPinned) badges += '<span class="badge badge-yellow" style="font-size:10px;">PINNED</span> ';
      else if (s.tier === 'auto') badges += '<span class="badge badge-blue" style="font-size:10px;">AUTO</span> ';
      
      const labels = (s.labels || []).map(l => `<span class="badge" style="font-size:10px; background:var(--bg-card); border:1px solid var(--border);">${this.esc(l)}</span>`).join(' ');

      return `
      <div class="snap-item ${s.isActive ? 'is-active' : ''}" data-id="${s.id}">
        <div class="snap-meta">
          <div class="snap-id">${s.id} ${badges}</div>
          <div class="snap-time">${this.fmtTime(s.timestamp)} · u/${this.esc(s.author)}</div>
          <div class="snap-note">${this.esc(s.note || '—')}</div>
          ${labels ? `<div style="margin-top:4px;">${labels}</div>` : ''}
        </div>
        <div class="snap-actions">
          <button class="btn btn-sm" data-action="view-snapshot" data-id="${this.esc(s.id)}">View</button>
          ${this.permissions.canEdit && !this.settings.readOnlyMode ? `<button class="btn btn-sm btn-red" data-action="rollback-snapshot" data-id="${this.esc(s.id)}">Rollback</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  renderDeployEvents() {
    const c = document.getElementById('deploy-list');
    if (!this.deployEvents.length) {
      c.innerHTML = '<div class="empty"><span class="title">No deploys yet</span></div>';
      return;
    }
    c.innerHTML = this.deployEvents.slice(0, 15).map(e => `
      <div class="deploy-item">
        <span class="deploy-dot"></span>
        <div><strong>${this.esc(e.note || 'Deploy')}</strong> · u/${this.esc(e.author)}<br/><span style="font-size:11px;color:var(--text-3);">${this.fmtTime(e.timestamp)}</span></div>
      </div>`).join('');
  }

  // ---- Draft & Editor ----
  bindDraftTab() {
    const editor = document.getElementById('yaml-editor');
    const src = document.getElementById('draft-source');
    let timer;

    editor.addEventListener('input', () => {
      this.currentDraftYaml = editor.value;
      this.draftIsDirty = true;
      clearTimeout(timer);
      timer = setTimeout(() => { this.updateDraftInfo(); this.runValidation(false); this.saveDraftToLocal(); }, 500);
    });
    
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = editor.selectionStart, end = editor.selectionEnd;
        editor.value = editor.value.substring(0, s) + '  ' + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = s + 2;
        this.currentDraftYaml = editor.value;
      }
    });

    if (src) {
      src.addEventListener('change', () => {
        document.getElementById('draft-snapshot-selector-group').style.display = src.value === 'snapshot' ? 'block' : 'none';
      });
    }

    // Start lease pinging when Draft tab is active
    document.querySelector('[data-tab="draft"]').addEventListener('click', () => {
      if (!this.leaseInterval) {
        this.send({ type: 'pingLease', data: { baseRevisionId: this.activeRevisionId } });
        this.leaseInterval = setInterval(() => {
          this.send({ type: 'pingLease', data: { baseRevisionId: this.activeRevisionId } });
        }, 60000); // ping every 1 minute
      }
    });

    // Clean up lease when switching away from draft
    document.querySelectorAll('.tab:not([data-tab="draft"])').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.leaseInterval) {
          clearInterval(this.leaseInterval);
          this.leaseInterval = null;
          this.send({ type: 'breakLease', data: {} });
        }
      });
    });

    document.getElementById('btn-load-draft').addEventListener('click', () => this.loadDraft());
    document.getElementById('btn-validate').addEventListener('click', () => this.runValidation(true));
    document.getElementById('btn-deploy').addEventListener('click', () => {
      this.getFreshDraftYaml();
      if (this.activeMission) {
         if (this.lastValidation && this.lastValidation.isValid) {
            let completed = [];
            try { completed = JSON.parse(localStorage.getItem('vigilonx_missions') || '[]'); } catch(e){}
            if (!completed.includes(this.activeMission.id)) {
               completed.push(this.activeMission.id);
               localStorage.setItem('vigilonx_missions', JSON.stringify(completed));
            }
            this.toast(`Mission '${this.activeMission.title}' Complete! 🎉`);
            this.activeMission = null;
            document.querySelector('[data-tab="training"]').click();
            this.renderTraining();
         } else {
            this.toast('Mission failed: Fix validation errors before completing.');
         }
         return;
      }

      if (this.settings.readOnlyMode) {
        this.toast('Deploys are disabled in Read-Only mode.', true);
        return;
      }
      
      // Policy Rules Evaluation
      if (this.settings.policyRules) {
        if (this.settings.policyRules.requireDeepValidate && !this.lastValidation) {
           this.toast('Policy Enforcement: You must run Deep Validate before deploying.', true);
           return;
        }
        if (this.settings.policyRules.requireRecentMilestone) {
           const hasMilestone = this.snapshots.some(s => s.tier === 'milestone');
           if (!hasMilestone) {
             this.toast('Policy Enforcement: Require at least 1 Milestone snapshot in history to deploy.', true);
             return;
           }
        }
      }

      if (this.settings.requireApprovals) {
        document.getElementById('modal-proposal-create').classList.add('active');
        document.getElementById('prop-desc').value = this.currentDraftYaml;
      } else {
        document.getElementById('modal-deploy').classList.add('active');
        const ts = document.getElementById('modal-deploy-test-status');
        ts.querySelector('svg').style.opacity = this.hasRunTests ? '1' : '0.3';
      }
    });
  }

  loadDraft() {
    const source = document.getElementById('draft-source').value;
    const editor = document.getElementById('yaml-editor');
    const label = document.getElementById('draft-source-label');
    if (source === 'active') { editor.value = this.activeConfig; this.currentDraftYaml = this.activeConfig; label.textContent = 'From active config'; }
    else if (source === 'snapshot') {
      const snap = this.snapshots.find(s => s.id === document.getElementById('draft-snapshot-select').value);
      if (snap) { editor.value = snap.configYaml; this.currentDraftYaml = snap.configYaml; label.textContent = `From snapshot ${snap.id}`; }
    } else { editor.value = ''; this.currentDraftYaml = ''; label.textContent = 'Empty draft'; }
    this.updateDraftInfo(); this.runValidation(true);
  }

  updateDraftInfo() {
    const y = this.currentDraftYaml || '';
    document.getElementById('draft-lines').textContent = y.split('\n').length;
    document.getElementById('draft-chars').textContent = y.length;
    try { document.getElementById('draft-rules').textContent = parseAutomodConfig(y).length; } catch { document.getElementById('draft-rules').textContent = '?'; }
  }

  runValidation(deep = true) {
    this.getFreshDraftYaml();

    let result = { isValid: true, errors: [], warnings: [], ruleCount: 0, lineCount: 0, charCount: 0 };
    
    // Always do fast syntactic checks
    try {
      result = validateAutomodConfig(this.currentDraftYaml || '');
    } catch (e) {
      result.errors.push({ message: `YAML parse error: ${e.message}` });
      result.isValid = false;
    }

    if (deep && result.isValid) {
      // Deep Validate: run guardrails
      if (typeof runGuardrails === 'function') {
        const guardrails = runGuardrails(this.currentDraftYaml || '');
        let ruleStartLines = [];
        try { ruleStartLines = parseAutomodConfig(this.currentDraftYaml || '').map(r => r.startLine); } catch(e) {}
        let checkedRules = 0;
        try { checkedRules = parseAutomodConfig(this.currentDraftYaml || '').length; } catch(e) {}
        
        for (const g of guardrails) {
           const line = ruleStartLines[g.ruleIndex];
           const label = `Rule ${g.ruleIndex + 1}${line ? ` (line ${line})` : ''}`;
           if (g.level === 'error') result.errors.push({ message: `${label}: ${g.message}`, line });
           else result.warnings.push({ message: `${label}: ${g.message}`, line });
        }
        
        // Partial coverage messaging for large configs
        const MAX_DEEP_RULES = 100;
        if (checkedRules > MAX_DEEP_RULES) {
          result.warnings.push({ message: `Deep Validate checked ${MAX_DEEP_RULES} of ${checkedRules} rules. Remaining ${checkedRules - MAX_DEEP_RULES} rules skipped for performance.` });
        }
      }
      this.lastDeepValidation = result;
      this.toast(`Deep validation complete — checked ${result.ruleCount} rule(s)`);
    }

    this.lastValidation = result;
    const st = document.getElementById('validation-status');
    st.textContent = result.isValid ? (deep ? 'Valid ✓' : 'Syntax OK') : 'Invalid ✗';
    st.className = 'vld-status ' + (result.isValid ? 'ok' : 'err');

    let html = '';
    for (const e of result.errors) html += `<li class="error">${this.esc(e.message)}${e.line ? ` (line ${e.line})` : ''}</li>`;
    for (const w of result.warnings) html += `<li class="warning">${this.esc(w.message)}${w.line && !String(w.message).includes(`line ${w.line}`) ? ` (line ${w.line})` : ''}</li>`;
    if (!deep && result.isValid) html = '<li style="color:var(--text-3);">Fast syntax check passed. Click "Validate" to run deep semantic checks & guardrails.</li>';
    if (deep && !html && result.isValid) html = '<li style="color:var(--green);">No issues found. Config is clean and ready to deploy.</li>';
    document.getElementById('validation-list').innerHTML = html;

    // Update deploy button state — 3 clear states: locked, proposal, deploy
    const btn = document.getElementById('btn-deploy');
    const hint = document.getElementById('deploy-hint');
    const mode = this.settings.operatingMode || 'safe';
    
    if (this.activeMission) {
      // Training mode — always show complete button
      btn.disabled = !result.isValid;
      btn.textContent = 'Complete Mission';
      hint.textContent = result.isValid ? 'Fix all issues then click to complete.' : 'Fix validation errors first.';
    } else if (result.isValid && (this.currentDraftYaml || '').trim()) {
      if (!this.permissions.canEdit) {
        btn.disabled = true;
        btn.textContent = 'Deploy Locked';
        hint.textContent = 'You need edit permissions to deploy.';
      } else if (mode === 'safe' || this.settings.configFreeze) {
        btn.disabled = true;
        btn.textContent = 'Deploy Locked';
        hint.textContent = mode === 'safe' 
          ? 'Safe Mode active — switch to Standard or Power mode in Settings.' 
          : 'Config Freeze active — disable freeze in Settings.';
      } else if (this.settings.requireApprovals) {
        btn.disabled = false;
        btn.textContent = 'Submit Proposal';
        hint.textContent = 'Approval required before deploy.';
      } else {
        btn.disabled = false;
        btn.textContent = 'Deploy to Live';
        hint.textContent = 'Ready to deploy.';
      }
    } else { 
      btn.disabled = true;
      btn.textContent = 'Deploy to Live';
      hint.textContent = result.isValid ? 'Write config first.' : 'Fix errors first.'; 
    }
    document.getElementById('draft-rules').textContent = result.ruleCount;
  }

  populateSnapshotDropdown() {
    document.getElementById('draft-snapshot-select').innerHTML = this.snapshots.map(s =>
      `<option value="${this.esc(s.id)}">${this.esc(s.id)} - ${this.fmtTime(s.timestamp)}${s.isActive ? ' (ACTIVE)' : ''}</option>`).join('');
  }

  // ---- Tester ----
  bindTesterTab() {
    document.querySelectorAll('.tpl-btn').forEach(b => b.addEventListener('click', () => this.applyTemplate(b.dataset.template)));
    document.getElementById('btn-run-test').addEventListener('click', () => this.runTest());
  }

  applyTemplate(name) {
    const t = {
      'spam-link': { title: 'Check out this amazing deal!!!', body: 'Click here: https://totallynotascam.xyz', domain: 'totallynotascam.xyz', isSelf: false, age: 0, karma: 1, author: 'xSpammer99', flair: '' },
      'quality-post': { title: 'Discussion: Best moderation practices', body: 'Sharing tips from 5 years of modding...', domain: 'self', isSelf: true, age: 1825, karma: 15000, author: 'ExperiencedMod', flair: 'Discussion' },
      'new-user': { title: 'Hi everyone!', body: 'Just joined, excited!', domain: 'self', isSelf: true, age: 0, karma: 1, author: 'NewUser2026', flair: '' },
      'low-karma': { title: 'Hot take: unpopular opinion', body: 'Everyone is wrong...', domain: 'self', isSelf: true, age: 90, karma: -50, author: 'ControversialUser', flair: '' },
    }[name];
    if (!t) return;
    document.getElementById('test-title').value = t.title;
    document.getElementById('test-body').value = t.body;
    document.getElementById('test-domain').value = t.domain;
    document.getElementById('test-author').value = t.author;
    document.getElementById('test-age').value = t.age;
    document.getElementById('test-karma').value = t.karma;
    document.getElementById('test-flair').value = t.flair;
    document.getElementById('test-self').checked = t.isSelf;
  }

  runTest() {
    const yaml = this.currentDraftYaml || this.activeConfig;
    if (!yaml.trim()) { this.toast('No config loaded.', true); return; }
    const item = {
      title: document.getElementById('test-title').value,
      body: document.getElementById('test-body').value,
      domain: document.getElementById('test-domain').value,
      isSelf: document.getElementById('test-self').checked,
      authorAccountAgeDays: Number(document.getElementById('test-age').value) || 0,
      authorKarma: Number(document.getElementById('test-karma').value) || 0,
      authorName: document.getElementById('test-author').value,
      flair: document.getElementById('test-flair').value,
    };
    const result = simulateRules(yaml, item);
    this.hasRunTests = true;
    document.getElementById('tester-source-label').textContent = this.currentDraftYaml ? 'Against draft' : 'Against active config';
    this.renderResults(result);
  }

  renderResults(result) {
    const c = document.getElementById('test-results');
    if (!result.matches.length) {
      c.innerHTML = `<div class="empty"><span class="title">No rules matched</span><span class="desc">Checked ${result.totalRulesChecked} rule(s). Item passes through.</span></div>`;
      return;
    }
    const ac = a => ({ remove: 'a-remove', spam: 'a-remove', approve: 'a-approve', report: 'a-report', filter: 'a-filter' }[a] || '');
    const covColors = { full: 'badge-green', partial: 'badge-yellow', none: 'badge-red' };
    c.innerHTML = `<div style="margin-bottom:6px;font-size:12px;color:var(--text-2);">${result.matches.length} of ${result.totalRulesChecked} matched</div>` +
      `<div style="margin-bottom:8px;font-size:11px;color:var(--text-3);font-style:italic;">${result.disclaimer}</div>` +
      result.matches.map(m => {
        const covBadge = m.coverageFlag ? `<span class="badge ${covColors[m.coverageFlag] || 'badge-blue'}" style="font-size:9px;" title="Simulation coverage: ${m.coverageFlag}">${m.coverageFlag.toUpperCase()}</span>` : '';
        const confBar = m.confidenceScore !== undefined ? `<div style="display:flex;align-items:center;gap:4px;margin-top:3px;"><span style="font-size:10px;color:var(--text-3);">Confidence:</span><div style="width:60px;height:4px;background:var(--border);border-radius:2px;"><div style="width:${m.confidenceScore}%;height:100%;background:${m.confidenceScore >= 80 ? 'var(--green)' : m.confidenceScore >= 50 ? 'var(--yellow)' : 'var(--red)'};border-radius:2px;"></div></div><span style="font-size:10px;color:var(--text-3);">${m.confidenceScore}%</span></div>` : '';
        return `
        <div class="result-item">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span class="result-action ${ac(m.action)}">${this.esc(m.action)}</span>
            <strong style="font-size:12px;">Rule ${m.ruleIndex + 1}</strong>
            ${covBadge}
            <span style="font-size:11px;color:var(--text-3);">${this.esc(m.ruleName)}</span>
          </div>
          <div style="font-size:11px;color:var(--text-2);">Matched: ${m.matchedChecks.map(ch => `<span class="badge badge-blue" style="font-size:10px;margin:1px;">${this.esc(ch)}</span>`).join(' ')}</div>
          ${m.warnings.length ? `<div style="font-size:11px;color:var(--yellow);margin-top:3px;">⚠️ ${m.warnings.map(w => this.esc(w)).join('; ')}</div>` : ''}
          ${confBar}
        </div>`;
      }).join('');
  }

  // ---- Lease & Warning ----
  showLeaseWarning() {
    if (!this.activeLease) return;
    if (document.getElementById('lease-warning-banner')) return;
    const time = new Date(this.activeLease.startTime).toLocaleTimeString();
    const banner = document.createElement('div');
    banner.id = 'lease-warning-banner';
    banner.className = 'conflict-banner';
    banner.style.background = 'var(--danger-dim)';
    banner.style.borderColor = 'var(--danger)';
    banner.innerHTML = `
      <div style="display:flex; align-items:center; gap:0.5rem; color:var(--danger); font-weight:600; margin-bottom:0.5rem">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Active Edit Session
      </div>
      <p style="margin:0 0 0.5rem; font-size:0.875rem">
        <strong>u/${this.esc(this.activeLease.user)}</strong> has been editing a draft since ${time}.
        You can open in Read-Only mode or fork from the current live config.
      </p>
      <div style="display:flex; gap:0.5rem">
        <button class="btn btn-sm" data-action="dismiss-banner">Acknowledge & Fork</button>
      </div>
    `;
    const panel = document.getElementById('panel-draft');
    if (panel) panel.prepend(banner);
  }

  // ---- Draft Recovery ----
  // Get subreddit-namespaced localStorage key to prevent cross-sub contamination
  _draftKey() {
    return this.subredditName ? `vigilonx_draft_${this.subredditName}` : 'vigilonx_draft';
  }

  checkDraftRecovery() {
    try {
      const savedDraft = localStorage.getItem(this._draftKey());
      if (savedDraft && savedDraft.trim() && !this.currentDraftYaml.trim()) {
        const banner = document.createElement('div');
        banner.className = 'system-banner info';
        banner.innerHTML = `
          <div class="system-banner-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Recovered Unsaved Draft
          </div>
          <div class="system-banner-body">We found a draft from your previous session (${savedDraft.split('\n').length} lines).</div>
          <div class="system-banner-actions">
            <button class="btn btn-sm btn-primary" id="btn-recover-draft">Load It</button>
            <button class="btn btn-sm" id="btn-discard-draft">Discard</button>
          </div>
        `;
        const panel = document.getElementById('panel-draft');
        if (panel) panel.prepend(banner);
        document.getElementById('btn-recover-draft').addEventListener('click', () => {
          document.getElementById('yaml-editor').value = savedDraft;
          this.currentDraftYaml = savedDraft;
          this.updateDraftInfo();
          this.runValidation(false);
          banner.remove();
          this.toast('Draft recovered from previous session.');
        });
        document.getElementById('btn-discard-draft').addEventListener('click', () => {
          localStorage.removeItem(this._draftKey());
          banner.remove();
        });
      }
    } catch (e) { /* localStorage not available */ }
  }

  saveDraftToLocal() {
    try {
      if (this.currentDraftYaml && this.currentDraftYaml.trim()) {
        localStorage.setItem(this._draftKey(), this.currentDraftYaml);
      }
    } catch (e) { /* localStorage not available */ }
  }

  clearLocalDraft() {
    try { localStorage.removeItem(this._draftKey()); } catch (e) {}
  }

  // ---- Settings ----
  bindSettingsTab() {
    document.getElementById('btn-save-settings').addEventListener('click', () => {
      const newSettings = {
        operatingMode: document.getElementById('set-operating-mode').value,
        readOnlyMode: document.getElementById('set-operating-mode').value === 'safe',
        requireApprovals: document.getElementById('set-require-approvals').checked,
        requiredApprovalCount: Number(document.getElementById('set-approval-count').value) || 1,
        sandboxSubreddits: document.getElementById('set-sandbox-subs').value.split(',').map(s => s.trim()).filter(Boolean),
        defaultStagedWindowHours: 0,
        retentionPolicies: this.settings.retentionPolicies || { system: 50, manual: 20, milestone: 0 },
        ecosystemAwareness: {
           aiAutomod: document.getElementById('set-ecosystem-ai').checked,
           mirrorSync: document.getElementById('set-ecosystem-sync').checked
        },
        crossSubFeatures: this.settings.crossSubFeatures || false,
        configFreeze: document.getElementById('set-config-freeze').checked,
        policyRules: {
           requireDeepValidate: document.getElementById('set-policy-deep-validate').checked,
           requireSandboxDeploy: document.getElementById('set-policy-sandbox').checked,
           requireRecentMilestone: document.getElementById('set-policy-milestone').checked
        }
      };
      this.send({ type: 'updateSettings', data: { settings: newSettings } });
    });
  }

  renderSettings() {
    document.getElementById('set-operating-mode').value = this.settings.operatingMode || 'safe';
    document.getElementById('set-require-approvals').checked = !!this.settings.requireApprovals;
    document.getElementById('set-approval-count').value = this.settings.requiredApprovalCount || 1;
    document.getElementById('set-sandbox-subs').value = (this.settings.sandboxSubreddits || []).join(', ');
    
    if (this.settings.ecosystemAwareness) {
       document.getElementById('set-ecosystem-ai').checked = !!this.settings.ecosystemAwareness.aiAutomod;
       document.getElementById('set-ecosystem-sync').checked = !!this.settings.ecosystemAwareness.mirrorSync;
    }
    
    document.getElementById('set-config-freeze').checked = !!this.settings.configFreeze;
    
    if (this.settings.policyRules) {
       document.getElementById('set-policy-deep-validate').checked = !!this.settings.policyRules.requireDeepValidate;
       document.getElementById('set-policy-sandbox').checked = !!this.settings.policyRules.requireSandboxDeploy;
       document.getElementById('set-policy-milestone').checked = !!this.settings.policyRules.requireRecentMilestone;
    }

    if (this.settings.configFreeze) {
       this.showConfigFreezeWarning();
    }
    
    const brakeBtn = document.getElementById('btn-emergency-brake');
    if (brakeBtn) {
       brakeBtn.style.display = this.permissions.canEdit ? 'flex' : 'none';
    }
  }

  showConfigFreezeWarning() {
    // Use the static freeze-banner element added in page.html
    const banner = document.getElementById('freeze-banner');
    if (banner) banner.style.display = 'block';
  }

  bindEmergencyBrake() {
    const btn = document.getElementById('btn-emergency-brake');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (confirm('EMERGENCY BRAKE: This will immediately rollback the active configuration to the last stable milestone, enable Config Freeze, and lock all deployments. Are you sure?')) {
         btn.textContent = 'Pulling Brake...';
         btn.disabled = true;
         this.send({ type: 'emergencyBrake' });
      }
    });
  }

  // ---- Proposals ----
  bindProposalsTab() {
    document.getElementById('btn-new-proposal').addEventListener('click', () => {
      if (!this.currentDraftYaml.trim()) {
        this.toast('Draft is empty. Write a config first to propose it.', true);
        return;
      }
      document.getElementById('prop-desc').value = this.currentDraftYaml;
      document.getElementById('modal-proposal-create').classList.add('active');
    });

    document.getElementById('btn-cancel-prop').addEventListener('click', () => this.closeModals());
    document.getElementById('btn-confirm-prop').addEventListener('click', () => {
      this.getFreshDraftYaml();
      const rationale = document.getElementById('prop-note').value;
      const data = {
        title: document.getElementById('prop-title').value,
        description: rationale,
        configYaml: this.currentDraftYaml,
        rationale,
        riskLevel: document.getElementById('prop-risk').value,
        checklist: {
          affectsModActions: document.getElementById('prop-chk-mod').checked,
          interactsWithBots: document.getElementById('prop-chk-bot').checked
        }
      };
      if (!data.title) { this.toast('Title is required', true); return; }
      this.send({ type: 'createProposal', data });
      this.closeModals();
    });
  }

  renderProposals() {
    const c = document.getElementById('proposal-list');
    if (!this.proposals || !this.proposals.length) {
      c.innerHTML = '<div class="empty"><span class="title">No proposals yet</span><span class="desc">Create a proposal from your draft config</span></div>';
      return;
    }

    const stColors = { draft: 'badge-blue', proposed: 'badge-yellow', approved: 'badge-green', rejected: 'badge-red', deployed: 'badge-green' };
    const rColors = { low: 'badge-blue', medium: 'badge-yellow', high: 'badge-red' };

    c.innerHTML = this.proposals.map(p => `
      <div class="snap-item" style="display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <strong>${this.esc(p.title)}</strong>
            <span class="badge ${stColors[p.status] || 'badge-blue'}">${p.status.toUpperCase()}</span>
            <span class="badge ${rColors[p.riskLevel] || 'badge-blue'}">${p.riskLevel} risk</span>
          </div>
          <div style="font-size:11px;color:var(--text-3);">${this.fmtTime(p.timestamp)}</div>
        </div>
        <div style="font-size:12px;color:var(--text-2);">${this.esc(this.truncate(p.description || p.rationale || 'No description provided.', 220))}</div>
        <div style="font-size:11px;color:var(--text-3);">By u/${this.esc(p.author)} · Approvals: ${p.approvals.length}/${this.settings.requiredApprovalCount || 1}</div>
        <div style="display:flex;gap:8px;margin-top:4px;">
          ${p.status === 'proposed' || p.status === 'approved' ? `
            ${this.permissions.canEdit && !p.approvals.includes(this.permissions.username) ? `<button class="btn btn-sm btn-primary" data-action="approve-proposal" data-id="${this.esc(p.id)}">Approve</button>` : ''}
            ${p.status === 'approved' && this.permissions.canEdit ? `<button class="btn btn-sm btn-green" data-action="deploy-proposal" data-id="${this.esc(p.id)}">Deploy</button>` : ''}
            ${this.permissions.canEdit ? `<button class="btn btn-sm btn-red" data-action="reject-proposal" data-id="${this.esc(p.id)}">Reject</button>` : ''}
          ` : ''}
          <button class="btn btn-sm" data-action="view-proposal-diff" data-id="${this.esc(p.id)}">View Diff</button>
        </div>
      </div>
    `).join('');
  }

  approveProposal(id) { this.send({ type: 'approveProposal', data: { proposalId: id } }); }
  rejectProposal(id) { this.send({ type: 'rejectProposal', data: { proposalId: id } }); }
  deployProposal(id) {
    const mode = this.settings.operatingMode || 'safe';
    if (mode === 'safe') { this.toast('Cannot deploy proposals in Safe Mode.', true); return; }
    if (this.settings.configFreeze) { this.toast('Config Freeze is active. Cannot deploy.', true); return; }
    this.send({ type: 'deployProposal', data: { proposalId: id } });
  }

  viewProposalDiff(id) {
    const p = this.proposals.find(x => x.id === id);
    if (!p) return;
    const diff = typeof computeRuleDiff === 'function' ? computeRuleDiff(this.activeConfig, p.configYaml) : null;
    if (diff) {
      document.getElementById('snapshot-view-title').textContent = `Diff: ${p.title}`;
      document.getElementById('snapshot-view-meta').innerHTML = `Comparing proposal config against current active config.`;
      document.getElementById('snapshot-view-content').innerHTML = renderDiffHtml(diff);
      document.getElementById('modal-snapshot-view').classList.add('active');
    }
  }

  // ---- Health & Audit ----
  bindHealthTab() {
    document.getElementById('btn-run-diff').addEventListener('click', () => {
      const a = document.getElementById('diff-a').value;
      const b = document.getElementById('diff-b').value;
      
      let yamlA = a === 'active' ? this.activeConfig : (a === 'draft' ? this.currentDraftYaml : '');
      let yamlB = b === 'active' ? this.activeConfig : (b === 'draft' ? this.currentDraftYaml : '');

      if (typeof computeRuleDiff === 'function') {
        const diff = computeRuleDiff(yamlA, yamlB);
        document.getElementById('diff-display').innerHTML = renderDiffHtml(diff);
      }
    });

    document.getElementById('btn-export-audit').addEventListener('click', () => {
      this.toast('Export requested. Generating...');
      setTimeout(() => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.auditEntries, null, 2));
        const a = document.createElement('a');
        a.href = dataStr;
        a.download = `vigilonx_audit_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
      }, 500);
    });
  }

  renderHealth() {
    if (typeof computeHealthScore === 'function') {
      const valRes = validateAutomodConfig(this.activeConfig || '');
      const h = computeHealthScore(this.activeConfig, valRes);
      let html = renderHealthScore(h);
      if (typeof renderHealthHistoryChart === 'function') {
        html += renderHealthHistoryChart(this.snapshots || []);
      }
      document.getElementById('health-display').innerHTML = html;
    }
    if (typeof runGuardrails === 'function') {
      const gr = runGuardrails(this.activeConfig);
      document.getElementById('guardrails-display').innerHTML = renderGuardrails(gr);
    }
  }

  renderAudit() {
    const c = document.getElementById('audit-display');
    if (!this.auditEntries || !this.auditEntries.length) {
      c.innerHTML = '<div class="empty"><span class="title">No audit entries yet</span></div>';
      return;
    }
    c.innerHTML = `<div style="max-height:300px;overflow-y:auto;">
      <table style="width:100%;font-size:12px;border-collapse:collapse;">
        <thead style="text-align:left;border-bottom:1px solid var(--border);color:var(--text-2);">
          <tr><th>Time</th><th>Action</th><th>User</th><th>Details</th></tr>
        </thead>
        <tbody>
          ${this.auditEntries.map(e => `
            <tr style="border-bottom:1px solid var(--border-light);">
              <td style="padding:6px 0;">${this.fmtTime(e.timestamp)}</td>
              <td style="padding:6px 0;"><span class="badge badge-blue">${e.type}</span></td>
              <td style="padding:6px 0;">u/${this.esc(e.author)}</td>
              <td style="padding:6px 0;color:var(--text-2);">${this.esc(e.detail)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table></div>`;
  }

  // ---- Patterns ----
  bindPatternsTab() {
    document.querySelectorAll('.pat-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pat-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderPatterns(btn.dataset.cat);
      });
    });
  }

  renderPatterns(filterCat = 'all') {
    if (typeof getBuiltInPatterns !== 'function') return;
    let pats = [...getBuiltInPatterns(), ...(this.communityPatterns || [])];
    if (filterCat !== 'all') pats = pats.filter(p => p.category === filterCat);
    
    document.getElementById('pattern-list').innerHTML = pats.map(p => renderPatternCard(p)).join('');
  }

  deletePattern(id) {
    if (!id) return;
    this.send({ type: 'deleteCommunityPattern', data: { patternId: id } });
  }

  openPatternWizard(id) {
    if (typeof getBuiltInPatterns !== 'function') return;
    const pat = getBuiltInPatterns().find(p => p.id === id);
    if (!pat) return;
    
    let html = `<p>${this.esc(pat.description)}</p><div style="margin:10px 0;">`;
    for (const p of (pat.parameters || [])) {
      html += `<div class="form-group"><label class="form-label">${this.esc(p.label)}</label>`;
      if (p.type === 'number') html += `<input type="number" class="input" id="pwiz-${p.key}" value="${p.default}" min="${p.min||''}" max="${p.max||''}" />`;
      else if (p.type === 'select') html += `<select class="input" id="pwiz-${p.key}">${(p.options||[]).map(o => `<option value="${o}" ${o===p.default?'selected':''}>${o}</option>`).join('')}</select>`;
      else html += `<input type="text" class="input" id="pwiz-${p.key}" value="${this.esc(p.default)}" />`;
      html += `</div>`;
    }
    html += `</div><div class="config-view" id="pwiz-preview" style="max-height:200px;"></div>`;
    
    document.getElementById('snapshot-view-title').textContent = `Pattern: ${pat.name}`;
    document.getElementById('snapshot-view-meta').innerHTML = '';
    document.getElementById('snapshot-view-content').innerHTML = html;
    
    // Add wizard behavior
    const updatePreview = () => {
      const vals = {};
      for (const p of (pat.parameters || [])) {
        const el = document.getElementById(`pwiz-${p.key}`);
        if (el) vals[p.key] = el.value;
      }
      document.getElementById('pwiz-preview').textContent = expandPatternYaml(pat, vals);
    };
    
    setTimeout(() => {
      updatePreview();
      for (const p of (pat.parameters || [])) {
        const el = document.getElementById(`pwiz-${p.key}`);
        if (el) el.addEventListener('input', updatePreview);
      }
    }, 10);

    // Override the Load into Draft button
    const loadBtn = document.getElementById('btn-snapshot-to-draft');
    const oldOnClick = loadBtn.onclick;
    const cloneBtn = loadBtn.cloneNode(true);
    loadBtn.parentNode.replaceChild(cloneBtn, loadBtn);
    
    cloneBtn.addEventListener('click', () => {
      const yaml = document.getElementById('pwiz-preview').textContent;
      const editor = document.getElementById('yaml-editor');
      const cur = editor.value;
      editor.value = cur + (cur.trim() && !cur.endsWith('\n') ? '\n\n' : '') + yaml;
      this.currentDraftYaml = editor.value;
      this.updateDraftInfo(); this.runValidation();
      this.closeModals();
      document.querySelector('[data-tab="draft"]').click();
      this.toast('Pattern appended to draft');
    });

    document.getElementById('modal-snapshot-view').classList.add('active');
  }

  renderTraining() {
    if (typeof getTrainingMissions !== 'function') return;
    const ms = getTrainingMissions();
    let completed = [];
    try { completed = JSON.parse(localStorage.getItem('vigilonx_missions') || '[]'); } catch(e){}
    document.getElementById('training-list').innerHTML = ms.map(m => renderMissionCard(m, completed.includes(m.id))).join('');
  }

  startMission(id) {
    if (typeof getTrainingMissions !== 'function') return;
    const m = getTrainingMissions().find(x => x.id === id);
    if (!m) return;
    
    document.getElementById('yaml-editor').value = m.brokenYaml;
    this.currentDraftYaml = m.brokenYaml;
    this.updateDraftInfo(); this.runValidation();
    document.getElementById('draft-source-label').textContent = `Training: ${m.title}`;
    
    // Set active mission state
    this.activeMission = m;
    this.updateTrainingIndicator();
    
    document.querySelector('[data-tab="draft"]').click();
    this.toast(`Mission started! Fix the issues and hit Deploy to complete.`);
  }

  // ---- Modals ----
  bindModals() {
    document.getElementById('btn-cancel-deploy').addEventListener('click', () => this.closeModals());
    document.getElementById('btn-confirm-deploy').addEventListener('click', () => {
      this.getFreshDraftYaml();
      this.send({ type: 'deployDraft', data: { configYaml: this.currentDraftYaml, note: document.getElementById('deploy-note').value } });
      document.getElementById('btn-confirm-deploy').disabled = true;
      document.getElementById('btn-confirm-deploy').textContent = 'Deploying...';
    });

    document.getElementById('btn-cancel-rollback').addEventListener('click', () => this.closeModals());
    document.getElementById('btn-confirm-rollback').addEventListener('click', () => {
      if (!this.pendingRollbackId) return;
      const btn = document.getElementById('btn-confirm-rollback');
      btn.disabled = true;
      btn.textContent = 'Rolling back...';
      
      let note = `Rollback to ${this.pendingRollbackId}`;
      let partialRuleIndices = [];
      
      // Check if partial rollback is used
      const checkboxes = document.querySelectorAll('#rollback-diff-container .diff-selector:checked');
      if (checkboxes.length > 0 && this.pendingRollbackDiff) {
         checkboxes.forEach(cb => partialRuleIndices.push(parseInt(cb.dataset.index, 10)));
         note = `Partial rollback to ${this.pendingRollbackId} (${partialRuleIndices.length} rules)`;
         
         // In a purely client-side setup, we could merge here and send as deployDraft.
         // But the backend expects rollbackToSnapshot. Let's merge here and deployDraft for simplicity
         // since rollback doesn't inherently support partial without backend changes.
         if (typeof mergePartialConfig === 'function') {
           const hybrid = mergePartialConfig(this.pendingRollbackDiff, partialRuleIndices);
           this.send({ type: 'deployDraft', data: { configYaml: hybrid, note: note } });
           return;
         }
      }
      
      this.send({
        type: 'rollbackToSnapshot',
        data: { snapshotId: this.pendingRollbackId, note: note }
      });
    });

    document.getElementById('btn-cancel-snapshot').addEventListener('click', () => this.closeModals());
    document.getElementById('btn-confirm-snapshot').addEventListener('click', () => {
      this.send({ type: 'createSnapshot', data: { 
        note: document.getElementById('snapshot-note-input').value,
        tier: document.getElementById('snapshot-tier-input').value
      } });
      document.getElementById('btn-confirm-snapshot').disabled = true;
    });

    document.getElementById('btn-close-snapshot-view').addEventListener('click', () => this.closeModals());
    
    // Default handler for load to draft (overridden by pattern wizard temporarily when needed)
    document.getElementById('btn-snapshot-to-draft').addEventListener('click', () => {
      if (this.viewingSnapshot) {
        document.getElementById('yaml-editor').value = this.viewingSnapshot.configYaml;
        this.currentDraftYaml = this.viewingSnapshot.configYaml;
        this.updateDraftInfo(); this.runValidation();
        document.getElementById('draft-source-label').textContent = `From snapshot ${this.viewingSnapshot.id}`;
        this.closeModals();
        document.querySelector('[data-tab="draft"]').click();
      }
    });

    document.querySelectorAll('.modal-bg').forEach(o => o.addEventListener('click', e => { if (e.target === o) this.closeModals(); }));
  }

  viewSnapshot(id) {
    const s = this.snapshots.find(x => x.id === id);
    if (!s) return;
    this.viewingSnapshot = s;
    document.getElementById('snapshot-view-title').textContent = `Snapshot ${s.id}`;
    document.getElementById('snapshot-view-meta').innerHTML = `${this.fmtTime(s.timestamp)} · u/${this.esc(s.author)}<br/>${s.note ? this.esc(s.note) : '(no note)'} · ${s.isActive ? '<span class="badge badge-green">ACTIVE</span>' : '<span class="badge badge-blue">SNAPSHOT</span>'}`;
    document.getElementById('snapshot-view-content').textContent = s.configYaml || '(empty)';
    
    // Restore the default load to draft handler if it was overwritten
    const btn = document.getElementById('btn-snapshot-to-draft');
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', () => {
      document.getElementById('yaml-editor').value = this.viewingSnapshot.configYaml;
      this.currentDraftYaml = this.viewingSnapshot.configYaml;
      this.updateDraftInfo(); this.runValidation();
      document.getElementById('draft-source-label').textContent = `From snapshot ${this.viewingSnapshot.id}`;
      this.closeModals();
      document.querySelector('[data-tab="draft"]').click();
    });

    document.getElementById('modal-snapshot-view').classList.add('active');
  }

  promptRollback(id) {
    const s = this.snapshots.find(x => x.id === id);
    if (!s) return;
    this.pendingRollbackId = id;
    
    // We compute a diff between live and this snapshot.
    // Wait, old is snapshot, new is live?
    // If we revert to snapshot, the snapshot is what we want.
    // Let's diff Live (new) vs Snapshot (old) so "Added" means the snapshot added it (reverting will add it to live).
    // Actually, old = live, new = snapshot makes more sense: what does the snapshot do TO the live config?
    const diff = typeof computeRuleDiff === 'function' ? computeRuleDiff(this.activeConfig, s.configYaml) : null;
    this.pendingRollbackDiff = diff;
    
    let html = `Restore <strong>${this.esc(s.id)}</strong> from ${this.fmtTime(s.timestamp)} as the live config.`;
    
    if (diff && diff.diffs.length > 0 && this.settings.operatingMode === 'power') {
      html += `<div style="margin-top:1rem; padding:1rem; border:1px solid var(--border); border-radius:8px; background:var(--bg-2)">
        <div style="margin-bottom:0.5rem; font-weight:600; color:var(--text-1);">Power Mode: Rule-Scope Rollback</div>
        <p style="font-size:0.875rem; color:var(--text-2); margin-bottom:1rem;">Select specific rule groups to revert. If none are selected, the entire snapshot will be restored.</p>
        <div id="rollback-diff-container" style="max-height: 250px; overflow-y: auto;">
          ${typeof renderDiffHtml === 'function' ? renderDiffHtml(diff, true) : ''}
        </div>
      </div>`;
    }
    
    document.getElementById('rollback-body').innerHTML = html;
    document.getElementById('modal-rollback').classList.add('active');
  }

  closeModals() {
    document.querySelectorAll('.modal-bg').forEach(m => m.classList.remove('active'));
    ['btn-confirm-deploy', 'btn-confirm-rollback', 'btn-confirm-snapshot', 'btn-confirm-prop'].forEach(id => {
      const b = document.getElementById(id);
      if (b) {
        b.disabled = false;
        if (id === 'btn-confirm-deploy') b.textContent = 'Confirm Deploy';
        if (id === 'btn-confirm-rollback') b.textContent = 'Confirm Rollback';
        if (id === 'btn-confirm-snapshot') b.textContent = 'Create Snapshot';
        if (id === 'btn-confirm-prop') b.textContent = 'Submit Proposal';
      }
    });
  }

  // ---- Render ----
  renderAll() {
    this.renderActiveConfig();
    this.renderSnapshots();
    this.renderDeployEvents();
    this.populateSnapshotDropdown();
    this.updateStatus('connected');
    document.getElementById('status-user').textContent = `u/${this.permissions.username}`;
    this.renderSettings();
    this.renderProposals();
    this.renderAudit();
    this.updateModeBadge();
    this.updateFreezeBanner();
    this.updateBrakeButton();
    this.restoreAISettings();
  }

  updateModeBadge() {
    // Use the static mode-badge element from page.html
    const badge = document.getElementById('mode-badge');
    if (!badge) return;
    const mode = this.settings.operatingMode || 'safe';
    const modeLabels = { safe: 'SAFE', standard: 'STD', power: 'POWER' };
    const modeClasses = { safe: 'badge-yellow', standard: 'badge-blue', power: 'badge-red' };
    badge.textContent = modeLabels[mode] || mode.toUpperCase();
    badge.className = `badge ${modeClasses[mode] || 'badge-blue'}`;
    badge.style.cssText = 'font-size:10px;';
  }

  updateFreezeBanner() {
    // Use the static freeze-banner element from page.html
    const banner = document.getElementById('freeze-banner');
    if (!banner) return;
    banner.style.display = this.settings.configFreeze ? 'block' : 'none';
  }

  updateTrainingIndicator() {
    const indicator = document.getElementById('training-indicator');
    if (indicator) {
      indicator.style.display = this.activeMission ? 'inline-flex' : 'none';
      if (this.activeMission) {
        indicator.textContent = '⚡ TRAINING: ' + this.activeMission.title;
      }
    }
  }

  updateBrakeButton() {
    const btn = document.getElementById('btn-emergency-brake');
    if (btn) {
      btn.style.display = this.permissions.canEdit ? 'flex' : 'none';
      btn.textContent = 'BRAKE';
      btn.disabled = false;
    }
  }

  updateStatus(s) {
    document.getElementById('status-dot').className = 'dot' + (s === 'connected' ? '' : ' off');
    document.getElementById('status-text').textContent = s === 'connected' ? 'Connected' : 'Disconnected';
  }

  toast(msg, isErr = false) {
    const container = document.getElementById('toast-container');
    const type = isErr ? 'error' : 'success';
    const iconSvg = isErr
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';

    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML =
      '<div class="toast-icon ' + type + '">' + iconSvg + '</div>' +
      '<div class="toast-body">' +
        '<div class="toast-title">' + (isErr ? 'Error' : 'Success') + '</div>' +
        '<div class="toast-msg">' + this.esc(msg) + '</div>' +
      '</div>' +
      '<button class="toast-close" data-action="close-toast">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
      '<div class="toast-progress"></div>';

    el.querySelector('.toast-close').addEventListener('click', function() {
      el.classList.add('removing');
      setTimeout(function() { el.remove(); }, 200);
    });

    container.appendChild(el);

    setTimeout(function() {
      if (el.parentElement) {
        el.classList.add('removing');
        setTimeout(function() { el.remove(); }, 200);
      }
    }, 5000);
  }

  fmtTime(iso) { try { return new Date(iso).toLocaleString(); } catch { return iso; } }
  getFreshDraftYaml() {
    const editor = document.getElementById('yaml-editor');
    if (editor) this.currentDraftYaml = editor.value;
    return this.currentDraftYaml;
  }
  truncate(s, max) {
    const text = String(s || '');
    return text.length > max ? text.substring(0, max - 1) + '...' : text;
  }
  esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  // ---- AI Assistance ----
  bindAIAssist() {
    try {
      const enableCb = document.getElementById('set-ai-enabled');
      const settingsGroup = document.getElementById('ai-settings-group');
      const assistSection = document.getElementById('ai-assist-section');
      const apiKeyInput = document.getElementById('set-ai-api-key');
      const modelSelect = document.getElementById('set-ai-model');
      const generateBtn = document.getElementById('btn-ai-generate');
      const explainBtn = document.getElementById('btn-ai-explain');
      const promptInput = document.getElementById('ai-prompt-input');

      if (!enableCb || !settingsGroup || !assistSection) return;

      enableCb.addEventListener('change', () => {
        this.aiEnabled = enableCb.checked;
        settingsGroup.style.display = this.aiEnabled ? 'block' : 'none';
        assistSection.style.display = this.aiEnabled ? 'block' : 'none';
        if (this.aiEnabled && apiKeyInput) {
          this.aiApiKey = apiKeyInput.value || '';
          this.aiModel = modelSelect ? modelSelect.value : 'gemini-2.5-flash';
        }
        this.saveAISettings();
        this.updateAIButtons();
      });

      if (apiKeyInput) {
        apiKeyInput.addEventListener('change', () => {
          this.aiApiKey = apiKeyInput.value || '';
          this.saveAISettings();
          this.updateAIButtons();
        });
      }

      if (modelSelect) {
        modelSelect.addEventListener('change', () => {
          this.aiModel = modelSelect.value;
          this.saveAISettings();
        });
      }

      if (generateBtn) {
        generateBtn.addEventListener('click', () => {
          const prompt = promptInput ? promptInput.value.trim() : '';
          if (!prompt) { this.toast('Enter a rule description first.', true); return; }
          if (!this.aiApiKey) { this.toast('Set your OpenAI API key in Settings.', true); return; }
          this.aiLoading = true;
          this.updateAIButtons();
          generateBtn.textContent = 'Generating...';
          document.getElementById('ai-error-output').style.display = 'none';
          document.getElementById('ai-explain-output').style.display = 'none';
          this.send({ type: 'aiGenerateRule', data: { prompt: prompt, apiKey: this.aiApiKey, model: this.aiModel } });
        });
      }

      if (explainBtn) {
        explainBtn.addEventListener('click', () => {
          this.getFreshDraftYaml();
          if (!this.currentDraftYaml.trim()) { this.toast('No draft to explain. Load or write a config first.', true); return; }
          if (!this.aiApiKey) { this.toast('Set your OpenAI API key in Settings.', true); return; }
          this.aiLoading = true;
          this.updateAIButtons();
          explainBtn.textContent = 'Analyzing...';
          document.getElementById('ai-error-output').style.display = 'none';
          this.send({ type: 'aiExplainDraft', data: { configYaml: this.currentDraftYaml, apiKey: this.aiApiKey, model: this.aiModel } });
        });
      }
    } catch (e) {}
  }

  updateAIButtons() {
    const generateBtn = document.getElementById('btn-ai-generate');
    const explainBtn = document.getElementById('btn-ai-explain');
    const canUse = this.aiEnabled && !!this.aiApiKey && !this.aiLoading;
    if (generateBtn) {
      generateBtn.disabled = !canUse;
      if (!this.aiLoading) generateBtn.textContent = 'Generate Rule';
    }
    if (explainBtn) {
      explainBtn.disabled = !canUse;
      if (!this.aiLoading) explainBtn.textContent = 'Explain Current Draft';
    }
  }

  saveAISettings() {
    try {
      sessionStorage.setItem('vigilonx_ai', JSON.stringify({
        enabled: this.aiEnabled,
        apiKey: this.aiApiKey,
        model: this.aiModel
      }));
    } catch (e) {}
  }

  restoreAISettings() {
    try {
      const raw = sessionStorage.getItem('vigilonx_ai');
      if (!raw) return;
      const saved = JSON.parse(raw);
      this.aiEnabled = !!saved.enabled;
      this.aiApiKey = saved.apiKey || '';
      this.aiModel = saved.model || 'gemini-2.5-flash';

      const enableCb = document.getElementById('set-ai-enabled');
      const settingsGroup = document.getElementById('ai-settings-group');
      const assistSection = document.getElementById('ai-assist-section');
      const apiKeyInput = document.getElementById('set-ai-api-key');
      const modelSelect = document.getElementById('set-ai-model');

      if (enableCb) enableCb.checked = this.aiEnabled;
      if (settingsGroup) settingsGroup.style.display = this.aiEnabled ? 'block' : 'none';
      if (assistSection) assistSection.style.display = this.aiEnabled ? 'block' : 'none';
      if (apiKeyInput) apiKeyInput.value = this.aiApiKey;
      if (modelSelect) modelSelect.value = this.aiModel;

      this.updateAIButtons();
    } catch (e) {}
  }
}

const app = new VigilonXApp();
