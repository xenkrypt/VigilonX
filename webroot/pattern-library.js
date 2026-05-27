/**
 * VigilonX – Pattern Library
 * Curated AutoMod rule patterns with interactive wizard support.
 */

const BUILTIN_PATTERNS = [
  {
    id: 'pat-age-gate', name: 'New Account Filter', category: 'gating',
    description: 'Remove or filter posts from accounts younger than a configurable threshold. Prevents drive-by spam and raid accounts.',
    yaml: '---\ntype: any\nauthor:\n    account_age: "< {{min_age_days}} days"\n    satisfy_any_threshold: true\n    combined_karma: "< {{min_karma}}"\naction: filter\naction_reason: "New account (age < {{min_age_days}}d, karma < {{min_karma}})"\n',
    examplesCatch: ['Brand new account posting links', 'Throwaway raid account'],
    examplesMiss: ['3-year-old account with 5000 karma', 'Moderator posts'],
    parameters: [
      { key: 'min_age_days', label: 'Minimum Account Age (days)', type: 'number', default: 7, min: 0, max: 365 },
      { key: 'min_karma', label: 'Minimum Combined Karma', type: 'number', default: 10, min: -100, max: 10000 }
    ],
    isBuiltIn: true,
    safetyLevel: 'safe',
    provenance: 'r/AutoModerator Standard'
  },
  {
    id: 'pat-link-spam', name: 'Suspicious Link Filter', category: 'spam',
    description: 'Flag or remove posts containing links from known spam domains or URL shorteners.',
    yaml: '---\ntype: submission\ndomain (includes): [{{blocked_domains}}]\naction: {{action}}\naction_reason: "Suspicious domain"\ncomment: "Your post was {{action}}d because it links to a domain flagged as suspicious."\n',
    examplesCatch: ['Post linking to bit.ly redirect', 'Post with known scam domain'],
    examplesMiss: ['Self post with no links', 'Post linking to reddit.com'],
    parameters: [
      { key: 'blocked_domains', label: 'Blocked Domains (comma-separated)', type: 'text', default: 'bit.ly, goo.gl, t.co, tinyurl.com' },
      { key: 'action', label: 'Action', type: 'select', default: 'filter', options: ['remove', 'filter', 'spam', 'report'] }
    ],
    isBuiltIn: true,
    safetyLevel: 'caution',
    provenance: 'Community Verified'
  },
  {
    id: 'pat-keyword-spam', name: 'Keyword Spam Detector', category: 'spam',
    description: 'Detect common spam keywords in titles and bodies. Catches crypto scams, fake giveaways, and phishing attempts.',
    yaml: '---\ntype: any\ntitle+body (includes-word): [{{keywords}}]\naction: {{action}}\naction_reason: "Spam keyword detected"\n',
    examplesCatch: ['FREE BITCOIN GIVEAWAY!!!', 'Click here to claim your prize'],
    examplesMiss: ['Discussion about cryptocurrency regulation', 'Legitimate giveaway by verified mod'],
    parameters: [
      { key: 'keywords', label: 'Spam Keywords (comma-separated)', type: 'text', default: 'free bitcoin, claim your prize, act now, limited offer, dm me' },
      { key: 'action', label: 'Action', type: 'select', default: 'remove', options: ['remove', 'filter', 'spam', 'report'] }
    ],
    isBuiltIn: true,
    safetyLevel: 'caution',
    provenance: 'Community Verified'
  },
  {
    id: 'pat-title-quality', name: 'Title Quality Gate', category: 'quality',
    description: 'Enforce minimum title length and reject ALL CAPS titles to improve post quality.',
    yaml: '---\ntype: submission\ntitle (regex): "^.{0,{{min_length}}}$"\naction: remove\ncomment: "Your post title is too short (minimum {{min_length}} characters). Please resubmit with a descriptive title."\n---\ntype: submission\ntitle (regex): "^[^a-z]{10,}$"\naction: remove\ncomment: "Please avoid ALL CAPS titles. Resubmit with normal capitalization."\n',
    examplesCatch: ['hi', 'LOOK AT THIS AMAZING THING WOW'],
    examplesMiss: ['Discussion: Best practices for community moderation in 2026', 'How do I configure AutoModerator?'],
    parameters: [
      { key: 'min_length', label: 'Minimum Title Length', type: 'number', default: 15, min: 1, max: 100 }
    ],
    isBuiltIn: true,
    safetyLevel: 'safe',
    provenance: 'r/AutoModerator Standard'
  },
  {
    id: 'pat-faq-reply', name: 'FAQ Auto-Reply', category: 'reply',
    description: 'Automatically reply to posts that match common questions with helpful links.',
    yaml: '---\ntype: submission\ntitle (includes-word): [{{trigger_words}}]\ncomment_stickied: true\ncomment: |\n    {{reply_text}}\n',
    examplesCatch: ['How do I get started?', 'Where are the rules?'],
    examplesMiss: ['Advanced discussion about edge cases'],
    parameters: [
      { key: 'trigger_words', label: 'Trigger Words (comma-separated)', type: 'text', default: 'help, getting started, new here, rules, faq' },
      { key: 'reply_text', label: 'Auto-Reply Text', type: 'text', default: 'Welcome! Please check our [Wiki](https://www.reddit.com/r/SUBREDDIT/wiki/) and [FAQ](https://www.reddit.com/r/SUBREDDIT/wiki/faq) before posting.' }
    ],
    isBuiltIn: true,
    safetyLevel: 'safe',
    provenance: 'Community Verified'
  },
  {
    id: 'pat-self-promo', name: 'Self-Promotion Limiter', category: 'spam',
    description: 'Flag users who predominantly post links to the same domain, indicating self-promotion.',
    yaml: '---\ntype: submission\nis_self: false\nauthor:\n    account_age: "< {{min_age_days}} days"\naction: filter\naction_reason: "Potential self-promotion from new account"\nreport_reason: "New account link post — possible self-promotion"\n',
    examplesCatch: ['New account posting YouTube link', 'Day-old account sharing blog'],
    examplesMiss: ['Established user sharing article', 'Self post discussion'],
    parameters: [
      { key: 'min_age_days', label: 'Min Account Age for Link Posts (days)', type: 'number', default: 30, min: 1, max: 365 }
    ],
    isBuiltIn: true,
    safetyLevel: 'caution',
    provenance: 'VigilonX Defaults'
  },
  {
    id: 'pat-low-karma-gate', name: 'Low Karma Gate', category: 'gating',
    description: 'Restrict posting for users with very low or negative karma to prevent trolling.',
    yaml: '---\ntype: any\nauthor:\n    combined_karma: "< {{min_karma}}"\naction: filter\naction_reason: "Low karma account (< {{min_karma}})"\nmodmail: "Low karma post filtered from u/{{author}}. Karma: needs review."\n',
    examplesCatch: ['Troll with -200 karma', 'Bot account with 0 karma'],
    examplesMiss: ['Regular user with 500 karma', 'Moderator with any karma'],
    parameters: [
      { key: 'min_karma', label: 'Minimum Karma', type: 'number', default: 0, min: -1000, max: 1000 }
    ],
    isBuiltIn: true,
    safetyLevel: 'safe',
    provenance: 'r/AutoModerator Standard'
  },
  {
    id: 'pat-flair-enforce', name: 'Flair Enforcement', category: 'quality',
    description: 'Require all submissions to have a flair, removing unflaired posts with a helpful reminder.',
    yaml: '---\ntype: submission\n~flair_text (regex): ".+"\naction: remove\ncomment: "Your post has been removed because it is not flaired. Please add a flair and resubmit."\n',
    examplesCatch: ['Any post without flair'],
    examplesMiss: ['Post with "Discussion" flair', 'Post with "Question" flair'],
    parameters: [],
    isBuiltIn: true,
    safetyLevel: 'safe',
    provenance: 'r/AutoModerator Standard'
  }
];

function getBuiltInPatterns() { return BUILTIN_PATTERNS; }

function expandPatternYaml(pattern, paramValues) {
  let yaml = pattern.yaml;
  for (const param of (pattern.parameters || [])) {
    const val = paramValues[param.key] !== undefined ? paramValues[param.key] : param.default;
    yaml = yaml.replace(new RegExp(`\\{\\{${param.key}\\}\\}`, 'g'), String(val));
  }
  return yaml;
}

function renderPatternCard(pattern) {
  const catColors = { spam: 'badge-red', quality: 'badge-yellow', gating: 'badge-blue', reply: 'badge-green' };
  const catClass = catColors[pattern.category] || 'badge-blue';
  const safetyColors = { safe: 'var(--green)', caution: 'var(--yellow)', expert: 'var(--red)' };
  const safetyColor = safetyColors[pattern.safetyLevel || 'safe'];
  
  return `<div class="pattern-card" data-id="${pattern.id}">
    <div class="pattern-head">
      <strong>${escPat(pattern.name)}</strong>
      <span class="badge ${catClass}">${escPat(pattern.category)}</span>
      <span style="font-size:10px; color:${safetyColor}; border:1px solid ${safetyColor}; padding:2px 4px; border-radius:3px;">${pattern.safetyLevel ? pattern.safetyLevel.toUpperCase() : 'SAFE'}</span>
      ${pattern.isBuiltIn ? '<span class="badge badge-blue">BUILT-IN</span>' : '<span class="badge badge-yellow">COMMUNITY</span>'}
    </div>
    <div style="font-size: 11px; color: var(--text-3); margin-bottom: 8px;">Source: ${pattern.provenance || 'Unknown'}</div>
    <p class="pattern-desc">${escPat(pattern.description)}</p>
    <div class="pattern-examples">
      <span class="pattern-catch">Catches: ${pattern.examplesCatch.map(e => `<em>${escPat(e)}</em>`).join(', ')}</span>
    </div>
    <div class="pattern-actions">
      <button class="btn btn-sm btn-primary" data-action="open-pattern" data-id="${escPat(pattern.id)}">Use Pattern</button>
      ${!pattern.isBuiltIn ? `<button class="btn btn-sm btn-red" data-action="delete-pattern" data-id="${escPat(pattern.id)}">Delete</button>` : ''}
    </div>
  </div>`;
}

function escPat(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}
