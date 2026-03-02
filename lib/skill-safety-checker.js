import fs from 'node:fs';
import path from 'node:path';

/**
 * Validate a single skill file's content against structural, content, and
 * safety rules.
 *
 * Each issue has the shape:
 *   { ruleId: string, severity: 'error'|'warning', message: string,
 *     filePath: string, line: number }
 *
 * Rule IDs:
 *   S01-S06  Structural (frontmatter)
 *   C01-C07  Content quality
 *   T01-T04  Safety / secrets
 *   X01-X02  Cross-reference integrity
 *
 * @param {string}   content       - Full text of SKILL.md
 * @param {string}   filePath      - Absolute path (used in returned issues)
 * @param {string[]} allSkillNames - Known skill names for X01 cross-ref check
 * @returns {Array<{ruleId:string, severity:string, message:string, filePath:string, line:number}>}
 */
export function validate(content, filePath, allSkillNames = []) {
    const issues = [];

    function issue(ruleId, severity, message, line = 1) {
        issues.push({ ruleId, severity, message, filePath, line });
    }

    // ---- Parse frontmatter -----------------------------------------------
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);

    if (!fmMatch) {
        issue('S01', 'error', 'missing or unparseable frontmatter');
        return issues; // nothing else can be reliably checked
    }

    const fmText  = fmMatch[1];
    const fmBlock = fmMatch[0]; // includes the --- delimiters

    // Parse key: value pairs (handles quoted and unquoted values)
    const fmFields = {};
    const knownKeys = new Set(['name', 'description']);

    for (const line of fmText.split('\n')) {
        // match:  key: "quoted value"  OR  key: 'quoted value'  OR  key: bare value
        const m = line.match(/^(\w+):\s*(?:"(.*?)"|'(.*?)'|(.*))$/);
        if (m) {
            fmFields[m[1]] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
        }
    }

    // S02: name present and non-empty
    if (!fmFields.name) {
        issue('S02', 'error', '`name` field is missing or empty in frontmatter');
    }

    // S03: name uses only lowercase letters, numbers, and hyphens
    if (fmFields.name && !/^[a-z0-9-]+$/.test(fmFields.name)) {
        issue('S03', 'error',
            `\`name\` "${fmFields.name}" contains invalid characters — use lowercase letters, numbers, and hyphens only`);
    }

    // S04: description present and non-empty
    if (!fmFields.description) {
        issue('S04', 'error', '`description` field is missing or empty in frontmatter');
    }

    // S05: total frontmatter ≤ 1024 characters
    if (fmBlock.length > 1024) {
        issue('S05', 'error',
            `frontmatter is ${fmBlock.length} characters; must be ≤ 1024 (Claude Code platform limit)`);
    }

    // S06: unknown frontmatter keys
    for (const key of Object.keys(fmFields)) {
        if (!knownKeys.has(key)) {
            issue('S06', 'error',
                `unknown frontmatter key "${key}"; only \`name\` and \`description\` are supported`);
        }
    }

    // ---- Content rules ---------------------------------------------------
    const desc = (fmFields.description || '').trim();

    // C01: description starts with "Use when"
    if (desc && !/^Use when/i.test(desc)) {
        issue('C01', 'warning',
            'description should start with "Use when" (CSO best practice — see writing-skills skill)');
    }

    // C05: no first-person pronouns in description
    if (/\b(I|my|we|our)\b/.test(desc)) {
        issue('C05', 'warning',
            'description contains first-person pronouns; descriptions are injected into system prompts and must be written in third person');
    }

    // C03: description ≤ 500 characters
    if (desc.length > 500) {
        issue('C03', 'warning',
            `description is ${desc.length} characters; target ≤ 500 for token efficiency`);
    }

    // C04: total word count ≤ 500
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    if (wordCount > 500) {
        issue('C04', 'warning',
            `word count ${wordCount} exceeds 500; trim for token efficiency (frequently-loaded skills should target < 200)`);
    }

    // C06: description should not enumerate workflow steps (summarize-workflow anti-pattern)
    // Heuristic: description contains ordered list indicators or step words
    if (/(\b(step|then|next|first|after)\b.*){2,}/i.test(desc)) {
        issue('C06', 'warning',
            'description appears to summarize workflow steps; descriptions should state WHEN to use the skill, not WHAT it does (see writing-skills CSO section)');
    }

    // C07: no @path cross-reference syntax (force-loads files, burns context)
    if (/@[a-z0-9_./-]+\.(md|js|ts|sh)/i.test(content)) {
        issue('C07', 'warning',
            '@file references in description or body force-load files immediately; prefer "Use superpowers:skill-name" cross-references instead');
    }

    // ---- Safety / secrets rules -----------------------------------------

    // T01: credential-like patterns
    // Matches patterns like  API_KEY="abc123..." or token: ghp_xxxx
    const credentialPattern =
        /(?:api[_-]?key|secret|password|token|bearer|auth)[=:\s]+["']?[A-Za-z0-9_\-./]{16,}/gi;
    if (credentialPattern.test(content)) {
        issue('T01', 'error',
            'possible credential or secret detected — do not commit API keys, tokens, or passwords in skill files');
    }

    // T02: email addresses (PII)
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    const emailMatches = content.match(emailPattern) || [];
    if (emailMatches.length > 0) {
        issue('T02', 'warning',
            `email address(es) detected (${emailMatches.slice(0, 2).join(', ')}); verify no PII is included`);
    }

    // T04: eval() or exec() in inline code
    if (/\beval\s*\(|\bexec\s*\(/.test(content)) {
        issue('T04', 'warning',
            'eval() or exec() appears in inline code example; ensure this is intentional and safe for the skill context');
    }

    // ---- Cross-reference integrity --------------------------------------

    // X01: superpowers:skill-name references resolve to known skills
    const xrefPattern = /superpowers:([a-z0-9-]+)/g;
    let m;
    while ((m = xrefPattern.exec(content)) !== null) {
        const refName = m[1];
        if (allSkillNames.length > 0 && !allSkillNames.includes(refName)) {
            issue('X01', 'warning',
                `cross-reference "superpowers:${refName}" does not match any discovered skill name`);
        }
    }

    return issues;
}

/**
 * Run the safety checker against all skills in one or more directories.
 *
 * @param {string[]} dirs - Directories to scan for skills
 * @returns {{ skill: object, issues: Array }[]}
 */
export async function checkAllSkills(dirs) {
    // Dynamic import to avoid circular dependency if skills-core is also ESM
    const { findSkillsInDir } = await import('./skills-core.js');

    const allSkills = [];
    for (const dir of dirs) {
        const found = findSkillsInDir(path.resolve(dir), 'check');
        allSkills.push(...found);
    }

    const allSkillNames = allSkills.map(s => s.name);

    return allSkills.map(skill => {
        const content = fs.readFileSync(skill.skillFile, 'utf8');
        const issues  = validate(content, skill.skillFile, allSkillNames);
        return { skill, issues };
    });
}
