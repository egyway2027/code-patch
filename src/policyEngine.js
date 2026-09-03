/** V23 centralized safety policy. Review findings never become silent commits. */
export const DEFAULT_POLICY = Object.freeze({
  security: Object.freeze({ critical:'block', high:'review', medium:'review', low:'info' }),
  impact: Object.freeze({ breakingChanges:'block', warnings:'review', dependencyCycles:'review' }),
  validation: Object.freeze({ requireParse:true, requireIntegrity:true, requireReplay:true, requireReviewApproval:true }),
  transaction: Object.freeze({ atomic:true, maxFiles:500, rejectExternalMutation:true }),
  analysis: Object.freeze({ taint:'heuristic', confidenceFloor:'high' }),
});

const POLICY_KEYS = Object.freeze({
  security:['critical','high','medium','low'],
  impact:['breakingChanges','warnings','dependencyCycles'],
  validation:['requireParse','requireIntegrity','requireReplay','requireReviewApproval'],
  transaction:['atomic','maxFiles','rejectExternalMutation'],
  analysis:['taint','confidenceFloor'],
});

export function normalizePolicy(input={}) {
  const out = {};
  for (const section of Object.keys(DEFAULT_POLICY)) {
    out[section] = {};
    const allowed = POLICY_KEYS[section] || [];
    for (const key of allowed) {
      const fallback = DEFAULT_POLICY[section][key];
      const value = input && typeof input === 'object' && input[section] && typeof input[section] === 'object'
        ? input[section][key] : undefined;
      if (typeof fallback === 'boolean') out[section][key] = typeof value === 'boolean' ? value : fallback;
      else if (typeof fallback === 'number') out[section][key] = Number.isInteger(value) && value > 0 ? value : fallback;
      else if (typeof fallback === 'string') out[section][key] = typeof value === 'string' && value.length <= 64 ? value : fallback;
    }
    Object.freeze(out[section]);
  }
  return Object.freeze(out);
}

export function evaluateSecurityPolicy(audit,policy=DEFAULT_POLICY){
  const p=normalizePolicy(policy),findings=Array.isArray(audit?.findings)?audit.findings:[];
  const blockers=findings.filter(f=>p.security[String(f.severity||'').toLowerCase()]==='block');
  const review=findings.filter(f=>p.security[String(f.severity||'').toLowerCase()]==='review');
  return {ok:blockers.length===0,blockers,review,decision:blockers.length?'BLOCK':review.length?'REVIEW':'PASS'};
}
export function evaluateImpactPolicy(impact,policy=DEFAULT_POLICY){
  const p=normalizePolicy(policy),breaking=Array.isArray(impact?.breaking)?impact.breaking:[],warnings=Array.isArray(impact?.warnings)?impact.warnings:[],cycles=Array.isArray(impact?.afterGraph?.cycles)?impact.afterGraph.cycles:[],blockers=[];
  if(breaking.length&&p.impact.breakingChanges==='block')blockers.push(...breaking.map(x=>({...x,policy:'breakingChanges'})));
  if(cycles.length&&p.impact.dependencyCycles==='block')blockers.push({kind:'dependency-cycle',cycles,policy:'dependencyCycles'});
  return {ok:blockers.length===0,blockers,review:warnings,decision:blockers.length?'BLOCK':warnings.length||cycles.length?'REVIEW':'PASS'};
}
