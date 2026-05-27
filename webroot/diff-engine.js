/**
 * VigilonX – Diff Engine
 * Rule-level diffing between two AutoMod configs.
 */

function computeRuleDiff(oldYaml, newYaml) {
  const oldRules = parseAutomodConfig(oldYaml || '');
  const newRules = parseAutomodConfig(newYaml || '');
  const diffs = [];
  const maxLen = Math.max(oldRules.length, newRules.length);
  const matchedOld = new Set();
  const matchedNew = new Set();
  const oldByHash = new Map();

  oldRules.forEach((rule, index) => {
    const hash = normalizeYaml(rule.raw);
    if (!oldByHash.has(hash)) oldByHash.set(hash, []);
    oldByHash.get(hash).push(index);
  });

  for (let i = 0; i < maxLen; i++) {
    const oldR = oldRules[i];
    const newR = newRules[i];
    if (oldR && newR && normalizeYaml(oldR.raw) === normalizeYaml(newR.raw)) {
      matchedOld.add(i);
      matchedNew.add(i);
      diffs.push({
        type: 'unchanged', ruleIndex: i,
        summary: `Rule ${i + 1} unchanged`,
        severity: 'safe'
      });
    }
  }

  for (let newIndex = 0; newIndex < newRules.length; newIndex++) {
    if (matchedNew.has(newIndex)) continue;
    const hash = normalizeYaml(newRules[newIndex].raw);
    const oldIndex = (oldByHash.get(hash) || []).find(i => !matchedOld.has(i));
    if (oldIndex === undefined) continue;
    matchedOld.add(oldIndex);
    matchedNew.add(newIndex);
    diffs.push({
      type: 'moved', ruleIndex: newIndex,
      oldRaw: oldRules[oldIndex].raw,
      newRaw: newRules[newIndex].raw,
      oldAction: oldRules[oldIndex].parsed.action || 'none',
      newAction: newRules[newIndex].parsed.action || 'none',
      summary: `Rule ${oldIndex + 1} moved to ${newIndex + 1}`,
      severity: 'safe'
    });
  }

  for (let i = 0; i < maxLen; i++) {
    const oldR = oldRules[i] || null;
    const newR = newRules[i] || null;
    if (matchedOld.has(i) || matchedNew.has(i)) continue;
    if (!oldR || !newR) continue;

    matchedOld.add(i);
    matchedNew.add(i);
    const actionChanged = (oldR.parsed.action || '') !== (newR.parsed.action || '');
    const changes = describeChanges(oldR.parsed, newR.parsed);
    diffs.push({
      type: 'modified', ruleIndex: i,
      oldRaw: oldR.raw, newRaw: newR.raw,
      oldAction: oldR.parsed.action || 'none',
      newAction: newR.parsed.action || 'none',
      summary: `Rule ${i + 1}: ${changes}`,
      severity: actionChanged ? 'danger' : 'warning'
    });
  }

  for (let i = 0; i < oldRules.length; i++) {
    if (matchedOld.has(i)) continue;
    const oldR = oldRules[i];
    diffs.push({
      type: 'removed', ruleIndex: i, oldRaw: oldR.raw,
      oldAction: oldR.parsed.action || 'none',
      summary: `Rule ${i + 1} removed (was: ${oldR.parsed.action || 'none'})`,
      severity: 'warning'
    });
  }

  for (let i = 0; i < newRules.length; i++) {
    if (matchedNew.has(i)) continue;
    const newR = newRules[i];
    diffs.push({
      type: 'added', ruleIndex: i, newRaw: newR.raw,
      newAction: newR.parsed.action || 'none',
      summary: `Rule ${i + 1} added (action: ${newR.parsed.action || 'none'})`,
      severity: severityForAction(newR.parsed.action)
    });
  }

  diffs.sort((a, b) => a.ruleIndex - b.ruleIndex);

  const added = diffs.filter(d => d.type === 'added').length;
  const removed = diffs.filter(d => d.type === 'removed').length;
  const modified = diffs.filter(d => d.type === 'modified').length;
  const unchanged = diffs.filter(d => d.type === 'unchanged').length;
  const moved = diffs.filter(d => d.type === 'moved').length;

  return { added, removed, modified, moved, unchanged, diffs, oldYaml, newYaml };
}

/**
 * Reconstructs a hybrid YAML string by taking the newYaml base and
 * reverting specifically selected rule indices back to their oldYaml state.
 */
function mergePartialConfig(diffSummary, selectedIndicesToRevert) {
  // If we want to revert rule N, we want the old config's version of rule N
  // But wait, our diff engine assumes line-by-line or index-based alignment.
  // Actually, we can just rebuild the array of raw strings.
  
  const oldRules = parseAutomodConfig(diffSummary.oldYaml || '');
  const newRules = parseAutomodConfig(diffSummary.newYaml || '');
  
  const finalRawBlocks = [];
  const maxLen = Math.max(oldRules.length, newRules.length);
  
  for (let i = 0; i < maxLen; i++) {
    const revertThis = selectedIndicesToRevert.includes(i);
    
    if (revertThis) {
      // Use the old rule
      if (oldRules[i] && oldRules[i].raw) finalRawBlocks.push(oldRules[i].raw);
    } else {
      // Keep the new rule
      if (newRules[i] && newRules[i].raw) finalRawBlocks.push(newRules[i].raw);
    }
  }
  
  // Join them with standard separators
  return finalRawBlocks.join('\n---\n');
}

function normalizeYaml(raw) {
  return (raw || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function describeChanges(oldP, newP) {
  const parts = [];
  const allKeys = new Set([...Object.keys(oldP), ...Object.keys(newP)]);
  let fieldChanges = 0;
  for (const k of allKeys) {
    const ov = JSON.stringify(oldP[k]);
    const nv = JSON.stringify(newP[k]);
    if (ov !== nv) {
      fieldChanges++;
      if (k === 'action') parts.push(`action: ${oldP[k] || 'none'} → ${newP[k] || 'none'}`);
    }
  }
  if (!parts.length) parts.push(`${fieldChanges} field(s) changed`);
  return parts.join(', ');
}

function severityForAction(action) {
  if (!action) return 'safe';
  const a = String(action).toLowerCase();
  if (a === 'remove' || a === 'spam') return 'danger';
  if (a === 'filter' || a === 'report') return 'warning';
  return 'safe';
}

function renderDiffHtml(diffSummary, allowSelection = false) {
  if (!diffSummary || !diffSummary.diffs.length) {
    return '<div class="empty"><span class="title">No differences</span></div>';
  }
  const badge = (type) => {
    const m = { added: 'badge-green', removed: 'badge-red', modified: 'badge-yellow', moved: 'badge-blue', unchanged: 'badge-blue' };
    return m[type] || '';
  };
  const sev = (s) => {
    const m = { danger: 'diff-danger', warning: 'diff-warning', safe: 'diff-safe' };
    return m[s] || '';
  };

  let html = `<div class="diff-summary-bar">
    <span class="badge badge-green">+${diffSummary.added}</span>
    <span class="badge badge-red">−${diffSummary.removed}</span>
    <span class="badge badge-yellow">~${diffSummary.modified}</span>
    <span class="badge badge-blue">moved ${diffSummary.moved || 0}</span>
    <span class="badge badge-blue">=${diffSummary.unchanged}</span>
  </div>`;

  for (const d of diffSummary.diffs) {
    if (d.type === 'unchanged') continue;
    html += `<div class="diff-item ${sev(d.severity)}">
      <div class="diff-head" style="display:flex; align-items:center; gap:0.5rem">
        ${allowSelection ? `<input type="checkbox" class="diff-selector" data-index="${d.ruleIndex}" />` : ''}
        <span class="badge ${badge(d.type)}">${d.type.toUpperCase()}</span>
        <span class="diff-desc">${escDiff(d.summary)}</span>
      </div>`;
    if (d.oldRaw || d.newRaw) {
      html += '<div class="diff-code-wrap">';
      if (d.oldRaw) html += `<pre class="diff-code diff-old">${escDiff(d.oldRaw)}</pre>`;
      if (d.newRaw) html += `<pre class="diff-code diff-new">${escDiff(d.newRaw)}</pre>`;
      html += '</div>';
    }
    html += '</div>';
  }
  return html;
}

function escDiff(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}
