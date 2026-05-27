/**
 * VigilonX – Health Score Engine
 * Computes an overall config health grade from validation, rule analysis, and structure.
 */

function computeHealthScore(yamlStr, validationResult) {
  const factors = [];
  let rules = [];
  try { rules = parseAutomodConfig(yamlStr || ''); } catch (e) { /* empty */ }

  // Factor 1: Validation cleanliness (30%)
  const errCount = validationResult ? validationResult.errors.length : 0;
  const warnCount = validationResult ? validationResult.warnings.length : 0;
  const validScore = Math.max(0, 100 - (errCount * 30) - (warnCount * 8));
  factors.push({ name: 'Validation', score: validScore, weight: 0.30,
    detail: errCount === 0 && warnCount === 0 ? 'No issues detected' : `${errCount} error(s), ${warnCount} warning(s)` });

  // Factor 2: Rule diversity — not all rules doing the same action (15%)
  const actionMap = {};
  for (const r of rules) {
    const a = String(r.parsed.action || 'none').toLowerCase();
    actionMap[a] = (actionMap[a] || 0) + 1;
  }
  const actionTypes = Object.keys(actionMap).length;
  const diversityScore = rules.length === 0 ? 50 : Math.min(100, actionTypes * 30);
  factors.push({ name: 'Action Diversity', score: diversityScore, weight: 0.15,
    detail: `${actionTypes} action type(s) across ${rules.length} rule(s)` });

  // Factor 3: Documentation — rules with action_reason or comment (15%)
  const documented = rules.filter(r => r.parsed.action_reason || r.parsed.comment).length;
  const docScore = rules.length === 0 ? 50 : Math.round((documented / rules.length) * 100);
  factors.push({ name: 'Documentation', score: docScore, weight: 0.15,
    detail: `${documented}/${rules.length} rules have action_reason or comment` });

  // Factor 4: Safety — moderators_exempt, risky regex, overly broad rules (20%)
  let safetyPenalty = 0;
  for (const r of rules) {
    if (r.parsed.moderators_exempt === false) safetyPenalty += 10;
    for (const key of Object.keys(r.parsed)) {
      if (key.includes('(regex)')) {
        const vals = Array.isArray(r.parsed[key]) ? r.parsed[key] : [r.parsed[key]];
        for (const v of vals) {
          if (typeof v === 'string' && (v === '.*' || v === '.+' || v === '.')) safetyPenalty += 15;
          // Check for potentially catastrophic backtracking
          if (typeof v === 'string' && /(\.\*){2,}/.test(v)) safetyPenalty += 10;
        }
      }
    }
  }
  const safetyScore = Math.max(0, 100 - safetyPenalty);
  factors.push({ name: 'Safety', score: safetyScore, weight: 0.20,
    detail: safetyPenalty === 0 ? 'No safety concerns' : `${safetyPenalty} penalty points from risky patterns` });

  // Factor 5: Structure — proper type declarations, not all "any" (10%)
  const withType = rules.filter(r => r.parsed.type && r.parsed.type !== 'any').length;
  const structScore = rules.length === 0 ? 50 : Math.round((withType / rules.length) * 100);
  factors.push({ name: 'Type Specificity', score: structScore, weight: 0.10,
    detail: `${withType}/${rules.length} rules have specific type (not 'any')` });

  // Factor 6: Rule count — too few or too many is a concern (10%)
  let countScore = 50;
  if (rules.length >= 3 && rules.length <= 50) countScore = 100;
  else if (rules.length >= 1 && rules.length < 3) countScore = 70;
  else if (rules.length > 50 && rules.length <= 100) countScore = 70;
  else if (rules.length > 100) countScore = 40;
  else countScore = 20;
  factors.push({ name: 'Rule Count', score: countScore, weight: 0.10,
    detail: `${rules.length} rule(s) — ${rules.length === 0 ? 'no rules defined' : rules.length > 50 ? 'consider consolidating' : 'healthy range'}` });

  // Weighted total
  const total = Math.round(factors.reduce((sum, f) => sum + f.score * f.weight, 0));
  const grade = total >= 90 ? 'A' : total >= 75 ? 'B' : total >= 60 ? 'C' : total >= 40 ? 'D' : 'F';

  return { grade, score: total, breakdown: factors };
}

function renderHealthScore(health) {
  const gradeColors = { A: 'var(--green)', B: '#2dd4bf', C: 'var(--yellow)', D: '#f59e0b', F: 'var(--red)' };
  const color = gradeColors[health.grade] || 'var(--text-1)';

  // Generate textual explanation
  const criticalCount = health.breakdown.filter(f => f.score < 40).length;
  const riskyCount = health.breakdown.filter(f => f.score >= 40 && f.score < 70).length;
  let explanation = '';
  if (health.grade === 'A') explanation = 'Excellent — No critical issues detected.';
  else if (health.grade === 'B') explanation = `Good — ${riskyCount} area(s) could be improved.`;
  else if (health.grade === 'C') explanation = `Fair — ${riskyCount} risky pattern(s), review recommended.`;
  else if (health.grade === 'D') explanation = `Poor — ${criticalCount} critical issue(s) and ${riskyCount} risky pattern(s).`;
  else explanation = `Failing — ${criticalCount} critical issue(s) need immediate attention.`;

  let html = `<div class="health-overview">
    <div class="health-grade" style="color:${color};border-color:${color}">${health.grade}</div>
    <div class="health-score-num">${health.score}<span>/100</span></div>
    <div style="font-size:12px; color:var(--text-2); margin-top:4px;">${explanation}</div>
  </div>`;

  html += '<div class="health-factors">';
  for (const f of health.breakdown) {
    const barColor = f.score >= 75 ? 'var(--green)' : f.score >= 50 ? 'var(--yellow)' : 'var(--red)';
    html += `<div class="health-factor">
      <div class="hf-head"><span class="hf-name">${f.name}</span><span class="hf-pct">${f.score}%</span></div>
      <div class="hf-bar"><div class="hf-fill" style="width:${f.score}%;background:${barColor}"></div></div>
      <div class="hf-detail">${f.detail}</div>
    </div>`;
  }
  html += '</div>';
  return html;
}

function renderHealthHistoryChart(snapshots) {
  if (!snapshots || snapshots.length < 2) {
    return '<div style="font-size:12px;color:var(--text-3);padding:12px 0;">Not enough snapshots to generate history chart.</div>';
  }
  
  // Get last 15 snapshots, chronologically (oldest first)
  const history = snapshots.slice(0, 15).reverse();
  const scores = history.map(s => {
     let r;
     try { r = parseAutomodConfig(s.configYaml || ''); } catch(e) { r = []; }
     // Rough estimate of valid score for history (we don't have full validation results)
     return computeHealthScore(s.configYaml, { errors: [], warnings: [] }).score;
  });
  
  const w = 300;
  const h = 60;
  const max = 100;
  const min = 40; // Don't chart below 40 to keep it visible
  const range = max - min;
  
  const stepX = w / (scores.length - 1);
  let path = '';
  
  for (let i = 0; i < scores.length; i++) {
    const x = i * stepX;
    const y = h - ((Math.max(min, scores[i]) - min) / range) * h;
    if (i === 0) path += `M ${x} ${y} `;
    else path += `L ${x} ${y} `;
  }
  
  return `
    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-light);">
      <div style="font-size: 13px; font-weight: 500; margin-bottom: 8px;">Health History (Last 15 Deploys)</div>
      <svg width="100%" height="${h}px" viewBox="0 -10 ${w} ${h+20}" preserveAspectRatio="none" style="overflow:visible; stroke-linecap:round; stroke-linejoin:round;">
        <path d="${path}" fill="none" stroke="var(--green)" stroke-width="2" />
        ${scores.map((s, i) => {
          const x = i * stepX;
          const y = h - ((Math.max(min, s) - min) / range) * h;
          return `<circle cx="${x}" cy="${y}" r="3" fill="var(--bg-1)" stroke="var(--green)" stroke-width="1.5" />
                  <title>Score: ${s}</title>`;
        }).join('')}
      </svg>
    </div>
  `;
}
