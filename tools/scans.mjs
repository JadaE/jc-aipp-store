// Shared scans: used by test.mjs (repo + dist secret scan) and the submissions batch (untrusted records).
// Keep patterns here so the store's own checks and the submission checks never drift apart.

// Secrets and private links. Same list test.mjs has always used.
export const SECRET_PATTERNS = [
  [/https?:\/\/[^\s"'<>)]*\.here\.now/i, 'here.now URL'],
  [/\b[a-z0-9-]+\.here\.now\b/, 'here.now host'],
  [/github_pat_[A-Za-z0-9_]{20,}|\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'API secret key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/"apiKey"\s*:\s*"(?!YOUR_)[^"]+"/, 'apiKey value'],
  [/HERENOW_API_KEY\s*=\s*["']?[A-Za-z0-9]{12,}/, 'hardcoded HERENOW_API_KEY'],
];

// Extra checks for submitted text (not applied to the store's own files).
export const SUBMISSION_SECRET_PATTERNS = [
  [/\bxox[abpsr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/[?&](?:token|key|apikey|api_key|secret|sig|signature|password|pw|auth)=[^&\s]{6,}/i, 'credential in URL'],
  [/\/(?:workspace|home|Users)\/[A-Za-z0-9._-]+/, 'local file path'],
  [/(?:^|[^A-Za-z0-9])(?:config\.local\.json|\.env)(?:$|[^A-Za-z0-9])/, 'private config file name'],
];

// Owner name, built from parts so this file never contains it.
export const OWNER_NAME = ['J', 'a', 'd', 'a'].join('');
export const PERSONAL_LABEL = /\((?:personal|private|family)\)/i;

// Hidden-instruction (prompt-injection) rules. A hit quarantines the record; alerts name only the record ID and rule.
export const HIDDEN_INSTRUCTION_RULES = [
  ['ignore-instructions', /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:instructions?|prompts?|rules?|guidelines|above|previous|prior)\b/i],
  ['system-prompt', /\b(?:system|developer)\s*(?:prompt|message|instructions?)\b/i],
  ['role-play', /\b(?:you are now|act as|pretend to be|from now on,? you|new instructions)\b/i],
  ['role-tag', /(?:^|\n)\s*(?:system|assistant|user|human|developer)\s*:/i],
  ['chat-markup', /<\/?(?:system|assistant|user|instructions?|im_start|im_end)\b|\[\/?INST\]|<\|[a-z_]+\|>/i],
  ['agent-tooling', /\b(?:SendToAgent|SendToUser|CallDynamicTool|tool[_ ]?calls?|function[_ ]?calls?|jailbreak|DAN mode|developer mode)\b/i],
  ['action-request', /\b(?:approve|merge|publish|release|deploy|delete|send)\b[^.\n]{0,30}\b(?:this|the|my)\b[^.\n]{0,20}\b(?:pr|pull request|listing|submission|record|email|key)s?\b[^.\n]{0,30}\b(?:now|immediately|automatically|without)\b/i],
  ['hidden-unicode', /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD]|[\u{E0000}-\u{E007F}]/u],
  ['base64-blob', /(?:[A-Za-z0-9+/]{40,}={0,2})/],
  ['markup-in-text', /<\s*(?:script|iframe|img|a|style|svg|object|embed)\b|javascript:|data:text\/html|on[a-z]+\s*=/i],
  ['markdown-link', /\[[^\]]{1,200}\]\([^)]+\)|!\[[^\]]*\]\(/],
];

// Returns [ruleName, ...] for text. Fields that are URLs skip the base64/markdown rules (they legitimately hold long paths).
export function hiddenInstructionHits(text, { isUrl = false } = {}) {
  const raw = String(text ?? '');
  // P3-3: also test the NFKC form (full-width and compatibility characters fold to ASCII).
  const t = raw === raw.normalize('NFKC') ? raw : `${raw}\n${raw.normalize('NFKC')}`;
  return HIDDEN_INSTRUCTION_RULES.filter(([name, re]) => !(isUrl && (name === 'base64-blob' || name === 'markdown-link')) && re.test(t)).map(([n]) => n);
}

export function secretHits(text, { localValues = [], extra = true } = {}) {
  const t = String(text ?? '');
  const hits = [...SECRET_PATTERNS, ...(extra ? SUBMISSION_SECRET_PATTERNS : [])].filter(([re]) => re.test(t)).map(([, n]) => n);
  if (localValues.some((v) => v && v.length >= 6 && t.includes(v))) hits.push('config.local.json value');
  return hits;
}

// privateTerms come from config.local.json (gitignored), never from the repo.
export function personalHits(text, { privateTerms = [] } = {}) {
  const t = String(text ?? '');
  const hits = [];
  if (new RegExp(`\\b${OWNER_NAME}\\b`, 'i').test(t)) hits.push('owner name');
  if (PERSONAL_LABEL.test(t)) hits.push('personal label');
  for (const term of privateTerms) if (term && term.length >= 3 && new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t)) { hits.push('private term'); break; }
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(t)) hits.push('email address in public text');
  return hits;
}
