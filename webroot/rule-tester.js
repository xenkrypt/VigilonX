/**
 * VigilonX – RuleTesterService
 * Simulates AutoModerator rule matching against a test item.
 * This is an APPROXIMATION based on public AutoModerator documentation.
 */

const DISCLAIMER = 'Simulation is based on public AutoModerator docs and may not perfectly match Reddit\'s internal engine. Test critical changes in a sandbox subreddit.';

function simulateRules(yamlStr, testItem) {
  const result = { matches: [], totalRulesChecked: 0, disclaimer: DISCLAIMER };

  let rules;
  try {
    rules = parseAutomodConfig(yamlStr);
  } catch (e) {
    return result;
  }

  result.totalRulesChecked = rules.length;

  for (const rule of rules) {
    const p = rule.parsed;
    const matchResult = evaluateRule(p, testItem, rule.index);
    if (matchResult) {
      result.matches.push(matchResult);
    }
  }

  return result;
}

function simulateTestSuite(yamlStr, suiteItems) {
  const matrix = [];
  for (const item of suiteItems) {
     matrix.push({ item, result: simulateRules(yamlStr, item) });
  }
  return matrix;
}

function evaluateRule(parsed, item, ruleIndex) {
  const matchedChecks = [];
  const warnings = [];
  let hasCondition = false;
  let allMatch = true;
  const isSatisfyAny = parsed.satisfy_any_threshold === true;

  // Determine rule type filter
  const ruleType = String(parsed.type || 'both').toLowerCase();
  // We treat all test items as submissions for simplicity

  // --- Title checks ---
  allMatch = checkTextField(parsed, 'title', item.title, matchedChecks, warnings, allMatch, () => { hasCondition = true; });

  // --- Body checks ---
  allMatch = checkTextField(parsed, 'body', item.body, matchedChecks, warnings, allMatch, () => { hasCondition = true; });

  // --- Domain checks ---
  if (parsed.domain || parsed['domain (includes)'] || parsed['domain (regex)']) {
    hasCondition = true;
    const domains = toArray(parsed.domain || parsed['domain (includes)']);
    if (domains.length > 0) {
      const domainMatch = domains.some(d => item.domain.toLowerCase().includes(String(d).toLowerCase()));
      if (domainMatch) matchedChecks.push('domain matched');
      else allMatch = false;
    }
    if (parsed['domain (regex)']) {
      const regResult = checkRegex(parsed['domain (regex)'], item.domain);
      if (regResult.matched) matchedChecks.push('domain (regex) matched');
      else allMatch = false;
      if (regResult.warning) warnings.push(regResult.warning);
    }
  }

  // --- Account age ---
  for (const op of ['<', '>', '<=', '>=']) {
    const key = `account_age ${op}`;
    if (parsed[key] !== undefined) {
      hasCondition = true;
      const threshold = parseDuration(parsed[key]);
      if (compareOp(item.authorAccountAgeDays, op, threshold)) {
        matchedChecks.push(`account_age ${op} ${parsed[key]}`);
      } else { allMatch = false; }
    }
  }
  if (parsed.account_age !== undefined) {
    hasCondition = true;
    // Simple numeric comparison
    const threshold = parseDuration(parsed.account_age);
    if (item.authorAccountAgeDays < threshold) {
      matchedChecks.push(`account_age < ${parsed.account_age}`);
    } else { allMatch = false; }
  }

  // --- Karma checks ---
  for (const karmaKey of ['post_karma', 'comment_karma', 'combined_karma']) {
    for (const op of ['<', '>', '<=', '>=']) {
      const key = `${karmaKey} ${op}`;
      if (parsed[key] !== undefined) {
        hasCondition = true;
        const threshold = Number(parsed[key]);
        if (compareOp(item.authorKarma, op, threshold)) {
          matchedChecks.push(`${key} ${parsed[key]}`);
        } else { allMatch = false; }
      }
    }
    if (parsed[karmaKey] !== undefined && typeof parsed[karmaKey] === 'number') {
      hasCondition = true;
      if (item.authorKarma < parsed[karmaKey]) {
        matchedChecks.push(`${karmaKey} < ${parsed[karmaKey]}`);
      } else { allMatch = false; }
    }
  }

  // --- Flair checks ---
  if (parsed.flair_text || parsed['flair_text (includes)']) {
    hasCondition = true;
    const flairValues = toArray(parsed.flair_text || parsed['flair_text (includes)']);
    const flairMatch = flairValues.some(f => item.flair.toLowerCase().includes(String(f).toLowerCase()));
    if (flairMatch) matchedChecks.push('flair_text matched');
    else allMatch = false;
  }

  // --- is_self check ---
  if (parsed.is_self !== undefined) {
    hasCondition = true;
    if (parsed.is_self === item.isSelf) matchedChecks.push('is_self matched');
    else allMatch = false;
  }

  // Check for unsimulated features
  const unsimulated = ['media_author', 'crosspost_title', 'crosspost_body', 'parent_submission', 'is_edited', 'is_top_level', 'body_shorter_than', 'body_longer_than', 'author'];
  let unknownKeysCount = 0;
  let knownKeysCount = 0;
  for (const key of Object.keys(parsed)) {
    if (['---', 'action', 'action_reason', 'comment', 'report_reason', 'message', 'modmail', 'satisfy_any_threshold'].includes(key)) continue;
    let isKnown = false;
    if (key.startsWith('title') || key.startsWith('body') || key.startsWith('domain') || key.startsWith('flair_text') || key.startsWith('account_age') || key.includes('karma') || key === 'is_self' || key === 'type') {
      isKnown = true;
    }
    if (unsimulated.some(u => key.startsWith(u))) {
      warnings.push(`Uses "${key}" which is not fully simulated.`);
      isKnown = false;
    }
    if (isKnown) knownKeysCount++;
    else unknownKeysCount++;
  }

  const coverageFlag = unknownKeysCount === 0 ? 'full' : (knownKeysCount > 0 ? 'partial' : 'none');
  const confidenceScore = coverageFlag === 'full' ? 100 : (coverageFlag === 'partial' ? 50 : 0);

  // Did this rule match?
  if (!hasCondition) return null; // No conditions = skip

  const matched = isSatisfyAny ? matchedChecks.length > 0 : allMatch && matchedChecks.length > 0;
  if (!matched) return null;

  // Determine action
  const action = String(parsed.action || 'none').toLowerCase();
  const ruleName = parsed.action_reason || parsed.comment || `Rule ${ruleIndex + 1}`;

  return {
    ruleIndex: ruleIndex,
    ruleName: typeof ruleName === 'string' ? ruleName.substring(0, 80) : `Rule ${ruleIndex + 1}`,
    action: action,
    matchedChecks: matchedChecks,
    warnings: warnings,
    coverageFlag,
    confidenceScore
  };
}

// --- Helpers ---

function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

function checkTextField(parsed, field, value, matchedChecks, warnings, allMatch, markHasCondition) {
  const checks = [
    { suffix: '', mode: 'includes' },
    { suffix: ' (includes)', mode: 'includes' },
    { suffix: ' (includes-word)', mode: 'includes-word' },
    { suffix: ' (regex)', mode: 'regex' },
    { suffix: ' (starts-with)', mode: 'starts-with' },
    { suffix: ' (ends-with)', mode: 'ends-with' },
    { suffix: ' (full-exact)', mode: 'full-exact' },
  ];

  for (const check of checks) {
    const key = field + check.suffix;
    if (parsed[key] === undefined) continue;
    markHasCondition();
    const patterns = toArray(parsed[key]);
    const lowerVal = (value || '').toLowerCase();

    let matched = false;
    for (const pattern of patterns) {
      const lp = String(pattern).toLowerCase();
      switch (check.mode) {
        case 'includes':
          if (lowerVal.includes(lp)) matched = true;
          break;
        case 'includes-word':
          if (new RegExp(`\\b${escapeRegex(lp)}\\b`, 'i').test(value || '')) matched = true;
          break;
        case 'regex': {
          const r = checkRegex(pattern, value || '');
          if (r.matched) matched = true;
          if (r.warning) warnings.push(r.warning);
          break;
        }
        case 'starts-with':
          if (lowerVal.startsWith(lp)) matched = true;
          break;
        case 'ends-with':
          if (lowerVal.endsWith(lp)) matched = true;
          break;
        case 'full-exact':
          if (lowerVal === lp) matched = true;
          break;
      }
      if (matched) break;
    }

    if (matched) matchedChecks.push(`${key} matched`);
    else allMatch = false;
  }

  return allMatch;
}

function checkRegex(pattern, value) {
  const patterns = toArray(pattern);
  for (const p of patterns) {
    try {
      if (new RegExp(String(p), 'i').test(value || '')) {
        return { matched: true, warning: null };
      }
    } catch (e) {
      return { matched: false, warning: `Invalid regex: "${p}"` };
    }
  }
  return { matched: false, warning: null };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDuration(val) {
  const s = String(val).toLowerCase().trim();
  const num = parseInt(s, 10);
  if (isNaN(num)) return 0;
  if (s.includes('hour')) return num / 24;
  if (s.includes('week')) return num * 7;
  if (s.includes('month')) return num * 30;
  if (s.includes('year')) return num * 365;
  return num; // default = days
}

function compareOp(val, op, threshold) {
  switch (op) {
    case '<': return val < threshold;
    case '>': return val > threshold;
    case '<=': return val <= threshold;
    case '>=': return val >= threshold;
    default: return false;
  }
}
