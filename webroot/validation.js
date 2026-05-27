/**
 * VigilonX – ValidationService
 * Validates AutoModerator YAML configs for syntax and semantic issues.
 */

function validateAutomodConfig(yamlStr) {
  const result = { isValid: true, errors: [], warnings: [], ruleCount: 0, lineCount: 0, charCount: 0 };
  result.lineCount = (yamlStr || '').split('\n').length;
  result.charCount = (yamlStr || '').length;

  if (!yamlStr || !yamlStr.trim()) {
    result.errors.push({ message: 'Configuration is empty.' });
    result.isValid = false;
    return result;
  }

  // Check for tab characters (YAML doesn't allow tabs)
  const lines = yamlStr.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('\t')) {
      result.errors.push({ message: `Tab character found. YAML requires spaces for indentation.`, line: i + 1 });
      result.isValid = false;
    }
    // Check for weird indentation (e.g. 1, 2, 3 spaces instead of 4)
    const match = lines[i].match(/^( +)[^ -]/);
    if (match) {
      const spaces = match[1].length;
      if (spaces % 4 !== 0 && spaces % 2 !== 0) {
        result.warnings.push({ message: `Irregular indentation of ${spaces} spaces detected. AutoModerator standard is 4 spaces.`, line: i + 1 });
      }
    }
  }

  // Check for unbalanced brackets/braces
  let brackets = 0, braces = 0;
  for (const ch of yamlStr) {
    if (ch === '[') brackets++;
    if (ch === ']') brackets--;
    if (ch === '{') braces++;
    if (ch === '}') braces--;
  }
  if (brackets !== 0) {
    result.errors.push({ message: 'Unbalanced square brackets [ ] detected.' });
    result.isValid = false;
  }
  if (braces !== 0) {
    result.errors.push({ message: 'Unbalanced curly braces { } detected.' });
    result.isValid = false;
  }

  // Parse into rules
  let rules;
  try {
    rules = parseAutomodConfig(yamlStr);
  } catch (e) {
    result.errors.push({ message: `YAML parse error: ${e.message}` });
    result.isValid = false;
    return result;
  }

  result.ruleCount = rules.length;

  if (rules.length === 0) {
    result.warnings.push({ message: 'No rules detected. Make sure rules are separated by "---".' });
  }

  // Per-rule semantic checks
  const validTypes = ['submission', 'comment', 'both', 'any'];
  const validActions = ['approve', 'remove', 'filter', 'spam', 'report'];
  const knownKeys = [
    'type', 'title', 'title (includes)', 'title (includes-word)', 'title (regex)',
    'title (starts-with)', 'title (ends-with)', 'title (full-exact)',
    'body', 'body (includes)', 'body (includes-word)', 'body (regex)',
    'body (starts-with)', 'body (ends-with)', 'body (full-exact)',
    'title+body', 'title+body (includes)', 'title+body (includes-word)', 'title+body (regex)',
    'domain', 'domain (includes)', 'domain (regex)', 'url',
    'author', 'action', 'action_reason', 'comment', 'comment_stickied',
    'modmail', 'modmail_subject', 'message', 'message_subject',
    'set_flair', 'set_sticky', 'set_nsfw', 'set_spoiler', 'set_contest_mode',
    'set_suggested_sort', 'set_locked', 'set_original_content',
    'report_reason', 'priority', 'moderators_exempt', 'is_edited', 'is_self',
    'is_top_level', 'parent_submission', 'id', 'media_author',
    'media_author_url', 'media_description', 'media_title',
    'flair_text', 'flair_css_class', 'flair_template_id',
    'crosspost_title', 'crosspost_body', 'crosspost_author',
    'satisfy_any_threshold', 'ignore_blockquotes',
  ];
  // Account-related keys (with operators)
  const accountKeys = [
    'account_age', 'post_karma', 'comment_karma', 'combined_karma',
    'satisfy_any_threshold',
  ];

  for (const rule of rules) {
    const p = rule.parsed;
    const ruleLabel = `Rule ${rule.index + 1}` + (rule.startLine ? ` (line ${rule.startLine})` : '');

    // Check type field
    if (p.type && !validTypes.includes(String(p.type).toLowerCase())) {
      result.warnings.push({ message: `${ruleLabel}: Unknown type "${p.type}". Expected: ${validTypes.join(', ')}.`, line: rule.startLine });
    }

    // Check action field
    if (p.action && !validActions.includes(String(p.action).toLowerCase())) {
      result.warnings.push({ message: `${ruleLabel}: Unknown action "${p.action}". Expected: ${validActions.join(', ')}.`, line: rule.startLine });
    }

    // No action defined
    const sideEffectKeys = [
      'set_flair', 'set_sticky', 'set_nsfw', 'set_spoiler', 'set_contest_mode',
      'set_suggested_sort', 'set_locked', 'set_original_content',
      'report_reason', 'comment', 'modmail', 'message'
    ];
    const hasSideEffect = sideEffectKeys.some(k => p[k] !== undefined);
    if (!p.action && !hasSideEffect) {
      result.warnings.push({ message: `${ruleLabel}: No action or side-effect defined. This rule may have no effect.`, line: rule.startLine });
    }

    // moderators_exempt: false warning
    if (p.moderators_exempt === false) {
      result.warnings.push({ message: `${ruleLabel}: "moderators_exempt: false" is set. This rule will apply to moderators too!`, line: rule.startLine });
    }

    // Check for account_age/karma without proper operator syntax
    // Reddit requires these under an "author" block or with operator like "< 1 days"
    const numericConditions = ['account_age', 'post_karma', 'comment_karma', 'combined_karma'];
    for (const cond of numericConditions) {
      if (p[cond] !== undefined) {
        const val = String(p[cond]).trim();
        // If it's just a bare number, that's invalid — Reddit needs "< N days" format or author block
        if (/^\d+$/.test(val)) {
          result.errors.push({ message: `${ruleLabel}: "${cond}: ${val}" is invalid. Use operator syntax like "${cond}: \\"< ${val} days\\"" or place under an "author:" block.`, line: rule.startLine });
          result.isValid = false;
        }
      }
    }

    // Check for potentially overly broad regex
    for (const key of Object.keys(p)) {
      if (key.includes('(regex)')) {
        const val = Array.isArray(p[key]) ? p[key] : [p[key]];
        for (const pattern of val) {
          if (typeof pattern === 'string') {
            if (pattern === '.*' || pattern === '.+' || pattern === '.') {
              result.warnings.push({ message: `${ruleLabel}: Very broad regex pattern "${pattern}" in "${key}" will match almost everything.`, line: rule.startLine });
            }
          }
        }
      }
    }

    // Warn about unknown top-level keys
    for (const key of Object.keys(p)) {
      const normalizedKey = key.replace(/\s*\(.*\)/, '').trim();
      const isKnown = knownKeys.some(k => k === key || k.startsWith(normalizedKey));
      const isAccountKey = accountKeys.some(k => key.startsWith(k));
      if (!isKnown && !isAccountKey && !key.startsWith('~') && !key.startsWith('author.')) {
        result.warnings.push({ message: `${ruleLabel}: Unknown key "${key}". This may be a typo.`, line: rule.startLine });
      }
    }
  }

  return result;
}
