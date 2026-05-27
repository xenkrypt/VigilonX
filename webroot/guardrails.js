/**
 * VigilonX – Guardrails
 * Common mistake detection based on r/AutoModerator best practices.
 * Layered on top of validation.js for enhanced linting.
 */

const GUARDRAIL_CHECKS = [
  {
    id: 'g-includes-short',
    check: (rule) => {
      const keys = Object.keys(rule.parsed);
      for (const k of keys) {
        if (k.includes('(includes)') && !k.includes('-word')) {
          const vals = Array.isArray(rule.parsed[k]) ? rule.parsed[k] : [rule.parsed[k]];
          const short = vals.filter(v => typeof v === 'string' && v.length <= 3);
          if (short.length > 0) {
            return { level: 'warning', message: `"${k}" has very short keyword(s): ${short.map(s => '"' + s + '"').join(', ')}. Consider using "includes-word" to avoid false positives.`, fix: `Change "${k}" to "${k.replace('(includes)', '(includes-word)')}"` };
          }
        }
      }
      return null;
    }
  },
  {
    id: 'g-type-mismatch',
    check: (rule) => {
      const type = String(rule.parsed.type || '').toLowerCase();
      const hasBody = Object.keys(rule.parsed).some(k => k.startsWith('body'));
      const hasTitle = Object.keys(rule.parsed).some(k => k.startsWith('title'));
      const hasDomainOrUrl = Object.keys(rule.parsed).some(k => k.startsWith('domain') || k.startsWith('url'));
      
      if (type === 'comment' && hasTitle) {
        return { level: 'error', message: 'Rule type is "comment" but checks "title". Comments don\'t have titles.', fix: 'Change type to "submission" or "any", or remove the title check.' };
      }
      if (type === 'comment' && hasDomainOrUrl) {
        return { level: 'warning', message: 'Rule type is "comment" but checks "domain" or "url". Comments don\'t have a domain field.', fix: 'If you want to check links in a comment, use "body (includes): [url]" instead.' };
      }
      if (type === 'submission' && !hasTitle && !hasBody && !hasDomainOrUrl && !rule.parsed.is_self) {
        return { level: 'info', message: 'Submission-only rule with no title/body/domain checks. Consider if type: "any" is more appropriate.' };
      }
      return null;
    }
  },
  {
    id: 'g-no-action-reason',
    check: (rule) => {
      const action = String(rule.parsed.action || '').toLowerCase();
      if ((action === 'remove' || action === 'spam' || action === 'filter') && !rule.parsed.action_reason) {
        return { level: 'info', message: `Rule uses "${action}" but has no action_reason. Adding one helps track removals in modlog.`, fix: 'Add action_reason: "descriptive reason"' };
      }
      return null;
    }
  },
  {
    id: 'g-remove-no-comment',
    check: (rule) => {
      const action = String(rule.parsed.action || '').toLowerCase();
      if (action === 'remove' && !rule.parsed.comment) {
        return { level: 'info', message: 'Rule removes content but leaves no comment. Users won\'t know why their post was removed.', fix: 'Add comment: "explanation for removal"' };
      }
      return null;
    }
  },
  {
    id: 'g-broad-regex',
    check: (rule) => {
      for (const key of Object.keys(rule.parsed)) {
        if (!key.includes('(regex)')) continue;
        const vals = Array.isArray(rule.parsed[key]) ? rule.parsed[key] : [rule.parsed[key]];
        for (const v of vals) {
          if (typeof v !== 'string') continue;
          if (/\.\{0,\}/.test(v) || /\(\.\*\)\{2,\}/.test(v)) {
            return { level: 'warning', message: `Regex "${v}" in "${key}" may cause excessive backtracking. Simplify the pattern.` };
          }
          if (v.length > 100) {
            return { level: 'info', message: `Long regex in "${key}" (${v.length} chars). Consider splitting into multiple simpler patterns.` };
          }
        }
      }
      return null;
    }
  },
  {
    id: 'g-modmail-flood',
    check: (rule) => {
      if (rule.parsed.modmail || rule.parsed.action === 'report') {
        const actionName = rule.parsed.modmail ? 'modmail' : 'reports';
        const hasAuthor = Object.keys(rule.parsed).some(k => k.startsWith('author'));
        const hasIsEdited = rule.parsed.is_edited !== undefined;
        const hasRestrictiveRegex = Object.keys(rule.parsed).some(k => {
          if (!k.includes('(regex)')) return false;
          const vals = Array.isArray(rule.parsed[k]) ? rule.parsed[k] : [rule.parsed[k]];
          return vals.some(v => typeof v === 'string' && !['.*', '.+', '.'].includes(v.trim()));
        });
        
        if (!hasAuthor && !hasIsEdited && !hasRestrictiveRegex) {
           return { level: 'warning', message: `Rule generates ${actionName} on very broad conditions. High-traffic subs may get flooded.`, fix: 'Add "is_edited: false" or author restrictions to limit noise.' };
        }
      }
      return null;
    }
  },
  {
    id: 'g-duplicate-action',
    check: (rule) => {
      if (rule.parsed.action && rule.parsed.report_reason) {
        const action = String(rule.parsed.action).toLowerCase();
        if (action === 'report') {
          return { level: 'info', message: 'Both "action: report" and "report_reason" are set. The report_reason is already implied by the report action.' };
        }
      }
      return null;
    }
  }
];

function runGuardrails(yamlStr) {
  let rules;
  try { rules = parseAutomodConfig(yamlStr || ''); } catch (e) { return []; }
  const results = [];
  for (const rule of rules) {
    for (const guard of GUARDRAIL_CHECKS) {
      const result = guard.check(rule);
      if (result) {
        results.push({ ruleIndex: rule.index, guardId: guard.id, ...result });
      }
    }
  }
  return results;
}

function renderGuardrails(results) {
  if (!results.length) {
    return '<div class="guardrail-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> No common mistakes detected</div>';
  }
  const icons = {
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  return results.map(r => {
    const cls = r.level === 'error' ? 'guardrail-error' : r.level === 'warning' ? 'guardrail-warn' : 'guardrail-info';
    return `<div class="guardrail-item ${cls}">
      <div class="gr-icon">${icons[r.level] || icons.info}</div>
      <div class="gr-body">
        <div class="gr-msg">Rule ${r.ruleIndex + 1}: ${escGR(r.message)}</div>
        ${r.fix ? `<div class="gr-fix">💡 ${escGR(r.fix)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function escGR(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
