/**
 * VigilonX – Training Missions
 * Pre-built training configs with intentional mistakes for mod onboarding.
 */

const TRAINING_MISSIONS = [
  {
    id: 'train-basics',
    title: 'Fix the Basics',
    description: 'This config has common YAML formatting mistakes: tab characters, missing separators, and typos. Find and fix all 3 issues.',
    difficulty: 'beginner',
    brokenYaml: "type: submission\ntitle (includes): [\"spam\"]\n\taction: remove\naction_reason: Spam detected\n---\ntype: comment\nbody (incldes): [\"buy now\"]\naction: remove",
    hints: [
      'YAML does not allow tab characters — use spaces',
      'Check for typos in key names like "includes"',
      'All issues are syntax-level — validation will catch them'
    ],
    expectedFixCount: 3
  },
  {
    id: 'train-safety',
    title: 'Safety First',
    description: 'This config works but has safety problems: overly broad regex, missing action_reason, and moderators_exempt issues. Improve it.',
    difficulty: 'intermediate',
    brokenYaml: '---\ntype: any\ntitle (regex): ".*"\naction: remove\nmoderators_exempt: false\n---\ntype: submission\nbody (includes): ["a"]\naction: spam',
    hints: [
      'A regex of ".*" matches everything — that will remove all posts!',
      'moderators_exempt: false means even mods get caught',
      'Searching for single-letter "a" will match nearly everything',
      'Missing action_reason makes modlog harder to read'
    ],
    expectedFixCount: 4
  },
  {
    id: 'train-advanced',
    title: 'Real-World Scenario',
    description: 'A subreddit is getting raided by new accounts posting scam links. Write rules to: 1) Filter posts from accounts < 3 days old, 2) Remove posts with known scam domains, 3) Auto-reply to filtered posts. Start from scratch.',
    difficulty: 'advanced',
    brokenYaml: '# Write your rules here\n---\n',
    hints: [
      'Use author block with account_age for age gating',
      'Use domain (includes) for domain blocking',
      'Use comment_stickied for auto-replies',
      'Check the Pattern Library for ready-made templates!'
    ],
    expectedFixCount: 0
  }
];

function getTrainingMissions() { return TRAINING_MISSIONS; }

function renderMissionCard(mission, completed) {
  const diffColors = { beginner: 'badge-green', intermediate: 'badge-yellow', advanced: 'badge-red' };
  const diffClass = diffColors[mission.difficulty] || 'badge-blue';
  return `<div class="mission-card ${completed ? 'completed' : ''}" data-id="${mission.id}">
    <div class="mission-head">
      <strong>${escM(mission.title)}</strong>
      <span class="badge ${diffClass}">${mission.difficulty}</span>
      ${completed ? '<span class="badge badge-green">✓ DONE</span>' : ''}
    </div>
    <p class="mission-desc">${escM(mission.description)}</p>
    <button class="btn btn-sm btn-primary" data-action="start-mission" data-id="${escM(mission.id)}">
      ${completed ? 'Retry' : 'Start Mission'}
    </button>
  </div>`;
}

function escM(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
