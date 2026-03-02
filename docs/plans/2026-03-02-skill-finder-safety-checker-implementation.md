# Scheduled Skill Finder & Safety Checker — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a scheduled skill finder and safety checker that validates all SKILL.md files against structural, content, and safety rules, runs nightly via GitHub Actions, and is also executable locally.

**Architecture:** A Node.js module (`lib/skill-safety-checker.js`) defines validation rules and uses the existing `lib/skills-core.js` for discovery. A CLI entry point (`commands/check-skills.js`) ties them together. A GitHub Actions workflow runs the CLI nightly.

**Tech Stack:** Node.js (ESM, built-ins only), GitHub Actions

---

### Task 1: Scaffold `lib/skill-safety-checker.js` with structural rule stubs

**Files:**
- Create: `lib/skill-safety-checker.js`
- Test: `tests/skill-safety-checker/structural-rules.test.js`

**Step 1: Write the failing test**

```javascript
// tests/skill-safety-checker/structural-rules.test.js
import { strict as assert } from 'node:assert';
import { validate } from '../../lib/skill-safety-checker.js';

// S01: missing frontmatter
{
  const issues = validate('no frontmatter here', 'fake/path/SKILL.md', []);
  assert.ok(issues.some(i => i.ruleId === 'S01'), 'S01 fires on missing frontmatter');
}

// S02: missing name
{
  const issues = validate('---\ndescription: Use when something\n---\n# Skill', 'fake/path/SKILL.md', []);
  assert.ok(issues.some(i => i.ruleId === 'S02'), 'S02 fires on missing name');
}

// S03: name with invalid chars
{
  const issues = validate('---\nname: My Skill (v2)\ndescription: Use when something\n---\n# Skill', 'fake/path/SKILL.md', []);
  assert.ok(issues.some(i => i.ruleId === 'S03'), 'S03 fires on name with invalid chars');
}

// S04: missing description
{
  const issues = validate('---\nname: my-skill\n---\n# Skill', 'fake/path/SKILL.md', []);
  assert.ok(issues.some(i => i.ruleId === 'S04'), 'S04 fires on missing description');
}

// S05: frontmatter > 1024 chars
{
  const longDesc = 'x'.repeat(1010);
  const issues = validate(`---\nname: my-skill\ndescription: ${longDesc}\n---\n# Skill`, 'fake/path/SKILL.md', []);
  assert.ok(issues.some(i => i.ruleId === 'S05'), 'S05 fires on oversized frontmatter');
}

// S06: unknown frontmatter key
{
  const issues = validate('---\nname: my-skill\ndescription: Use when something\nwhen_to_use: something\n---\n# Skill', 'fake/path/SKILL.md', []);
  assert.ok(issues.some(i => i.ruleId === 'S06'), 'S06 fires on unknown frontmatter key');
}

// Clean skill produces no structural errors
{
  const issues = validate('---\nname: my-skill\ndescription: Use when something happens\n---\n# Skill', 'fake/path/SKILL.md', []);
  const errors = issues.filter(i => i.severity === 'error');
  assert.strictEqual(errors.length, 0, 'clean skill has no structural errors');
}

console.log('All structural rule tests passed');
```

**Step 2: Run test to verify it fails**

```bash
node --test tests/skill-safety-checker/structural-rules.test.js 2>&1 || node tests/skill-safety-checker/structural-rules.test.js
```

Expected: Error – `validate` not found / module missing

**Step 3: Write minimal implementation**

```javascript
// lib/skill-safety-checker.js
/**
 * Validate a single skill file's content against structural, content, and
 * safety rules. Returns an array of issue objects.
 *
 * @param {string} content     - Full file content of SKILL.md
 * @param {string} filePath    - Absolute path (used in issue objects)
 * @param {string[]} allSkillNames - All known skill names (for cross-ref checks)
 * @returns {Array<{ruleId, severity, message, filePath, line}>}
 */
export function validate(content, filePath, allSkillNames = []) {
  const issues = [];

  function issue(ruleId, severity, message, line = 1) {
    issues.push({ ruleId, severity, message, filePath, line });
  }

  // --- Parse frontmatter ---
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    issue('S01', 'error', 'missing or unparseable frontmatter');
    return issues; // nothing else can be checked
  }

  const fmText = fmMatch[1];
  const fmLength = fmMatch[0].length;
  const fmFields = {};
  const knownKeys = new Set(['name', 'description']);

  for (const line of fmText.split('\n')) {
    const m = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    if (m) fmFields[m[1]] = m[2];
  }

  // S02: name present
  if (!fmFields.name || !fmFields.name.trim()) {
    issue('S02', 'error', '`name` field is missing or empty');
  }

  // S03: name format
  if (fmFields.name && !/^[a-z0-9-]+$/.test(fmFields.name.trim())) {
    issue('S03', 'error', `\`name\` "${fmFields.name}" contains invalid characters (use lowercase letters, numbers, and hyphens only)`);
  }

  // S04: description present
  if (!fmFields.description || !fmFields.description.trim()) {
    issue('S04', 'error', '`description` field is missing or empty');
  }

  // S05: frontmatter length
  if (fmLength > 1024) {
    issue('S05', 'error', `frontmatter is ${fmLength} characters; must be ≤ 1024`);
  }

  // S06: unknown keys
  for (const key of Object.keys(fmFields)) {
    if (!knownKeys.has(key)) {
      issue('S06', 'error', `unknown frontmatter key "${key}"; only \`name\` and \`description\` are supported`);
    }
  }

  // --- Content rules ---
  const desc = (fmFields.description || '').trim();

  // C01: starts with "Use when"
  if (desc && !/^Use when/i.test(desc)) {
    issue('C01', 'warning', 'description should start with "Use when" (CSO best practice)');
  }

  // C02/C05: no first-person pronouns
  if (/\b(I|my|we|our)\b/.test(desc)) {
    issue('C05', 'warning', 'description contains first-person pronouns; write in third person');
  }

  // C03: description length
  if (desc.length > 500) {
    issue('C03', 'warning', `description is ${desc.length} characters; target ≤ 500 for token efficiency`);
  }

  // C04: total word count
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  if (wordCount > 500) {
    issue('C04', 'warning', `word count ${wordCount} exceeds 500; consider trimming for token efficiency`);
  }

  // --- Safety rules ---
  const credentialPattern = /(?:api[_-]?key|secret|password|token|auth)[=:]\s*["']?[A-Za-z0-9_\-]{16,}/gi;
  if (credentialPattern.test(content)) {
    issue('T01', 'error', 'possible credential or secret detected in skill content');
  }

  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi;
  if (emailPattern.test(content)) {
    issue('T02', 'warning', 'email address detected; verify no PII is included');
  }

  const evalPattern = /\beval\s*\(|\bexec\s*\(/;
  if (evalPattern.test(content)) {
    issue('T04', 'warning', 'eval() or exec() in inline code; ensure this is intentional and safe');
  }

  // --- Cross-reference rules ---
  const xrefPattern = /superpowers:([a-z0-9-]+)/g;
  let m;
  while ((m = xrefPattern.exec(content)) !== null) {
    const refName = m[1];
    if (allSkillNames.length > 0 && !allSkillNames.includes(refName)) {
      issue('X01', 'warning', `cross-reference "superpowers:${refName}" does not match any known skill`);
    }
  }

  return issues;
}
```

**Step 4: Run test to verify it passes**

```bash
node tests/skill-safety-checker/structural-rules.test.js
```

Expected: `All structural rule tests passed`

**Step 5: Commit**

```bash
git add lib/skill-safety-checker.js tests/skill-safety-checker/structural-rules.test.js
git commit -m "feat: scaffold skill-safety-checker with structural and content rules"
```

---

### Task 2: Create `commands/check-skills.js` CLI entry point

**Files:**
- Create: `commands/check-skills.js`
- Test: manual smoke-test against `skills/` directory

**Step 1: Write the file**

```javascript
#!/usr/bin/env node
// commands/check-skills.js
// Usage: node commands/check-skills.js [--dirs dir1 dir2 ...]
//        node commands/check-skills.js --ci   (emit GitHub Annotations)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSkillsInDir } from '../lib/skills-core.js';
import { validate } from '../lib/skill-safety-checker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// Parse args
const args = process.argv.slice(2);
const ciMode = args.includes('--ci');
const dirsIdx = args.indexOf('--dirs');
const dirs = dirsIdx !== -1
  ? args.slice(dirsIdx + 1).filter(a => !a.startsWith('--'))
  : [path.join(repoRoot, 'skills')];

// Discover skills
const allSkills = [];
for (const dir of dirs) {
  const found = findSkillsInDir(path.resolve(dir), 'check');
  allSkills.push(...found);
}

const allSkillNames = allSkills.map(s => s.name);

console.log(`Checking ${allSkills.length} skills...\n`);

let totalWarn = 0;
let totalFail = 0;

for (const skill of allSkills) {
  const content = fs.readFileSync(skill.skillFile, 'utf8');
  const issues = validate(content, skill.skillFile, allSkillNames);

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  if (errors.length > 0) {
    console.log(`❌  ${skill.name.padEnd(30)} (${errors.length} error${errors.length > 1 ? 's' : ''}, ${warnings.length} warning${warnings.length !== 1 ? 's' : ''})`);
    totalFail++;
  } else if (warnings.length > 0) {
    console.log(`⚠️   ${skill.name.padEnd(30)} (${warnings.length} warning${warnings.length !== 1 ? 's' : ''})`);
    totalWarn++;
  } else {
    console.log(`✅  ${skill.name.padEnd(30)} (0 issues)`);
  }

  for (const issue of issues) {
    const prefix = issue.severity === 'error' ? '   ❌' : '   ⚠️ ';
    console.log(`${prefix} ${issue.ruleId}  ${issue.message}`);

    if (ciMode) {
      const level = issue.severity === 'error' ? 'error' : 'warning';
      console.log(`::${level} file=${issue.filePath},line=${issue.line}::${issue.ruleId}: ${issue.message}`);
    }
  }
}

const total = allSkills.length;
const totalPass = total - totalFail - totalWarn;

console.log(`\nSummary: ${total} skill${total !== 1 ? 's' : ''}, ${totalPass} pass, ${totalWarn} warn, ${totalFail} fail`);

if (totalFail > 0) {
  process.exit(1);
}
```

**Step 2: Smoke-test locally**

```bash
node commands/check-skills.js --dirs skills
```

Expected: Report listing all skills with pass/warn/fail status

**Step 3: Commit**

```bash
git add commands/check-skills.js
git commit -m "feat: add check-skills CLI entry point"
```

---

### Task 3: Create `.github/workflows/skill-safety-check.yml`

**Files:**
- Create: `.github/workflows/skill-safety-check.yml`

**Step 1: Write the workflow**

```yaml
name: Skill Safety Check

on:
  schedule:
    - cron: '0 3 * * *'   # Nightly at 03:00 UTC
  push:
    paths:
      - 'skills/**'
      - 'lib/skill-safety-checker.js'
      - 'commands/check-skills.js'
  pull_request:
    paths:
      - 'skills/**'
  workflow_dispatch:

jobs:
  check:
    name: Validate Skills
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Run skill safety check
        run: node commands/check-skills.js --dirs skills --ci
```

**Step 2: Validate the YAML locally**

```bash
node -e "require('yaml') || true" 2>/dev/null; echo "check yaml syntax manually"
cat .github/workflows/skill-safety-check.yml
```

Expected: Well-formed YAML, no syntax errors

**Step 3: Commit**

```bash
git add .github/workflows/skill-safety-check.yml
git commit -m "feat: add nightly skill safety check GitHub Actions workflow"
```

---

### Task 4: Create `skills/choosing-agent-mode/SKILL.md`

**Files:**
- Create: `skills/choosing-agent-mode/SKILL.md`

(Content specified in design doc and covered by the separate skill file.)

**Step 1: Create the skill file** (see the choosing-agent-mode skill)

**Step 2: Run the safety checker against the new skill**

```bash
node commands/check-skills.js --dirs skills/choosing-agent-mode
```

Expected: `✅  choosing-agent-mode  (0 issues)`

**Step 3: Commit**

```bash
git add skills/choosing-agent-mode/SKILL.md
git commit -m "feat: add choosing-agent-mode skill"
```

---

### Task 5: Validate all existing skills and fix violations

**Files:**
- Modify: any `skills/*/SKILL.md` that fail checks

**Step 1: Run the full check**

```bash
node commands/check-skills.js --dirs skills
```

**Step 2: For each FAIL, apply the minimal fix** (e.g., add missing `name`, remove unknown keys)

**Step 3: Re-run until clean**

```bash
node commands/check-skills.js --dirs skills
```

Expected: Exit code 0, no errors

**Step 4: Commit**

```bash
git add skills/
git commit -m "fix: resolve skill safety checker violations in existing skills"
```

---

### Task 6: Write package.json script shortcut (optional convenience)

If `package.json` exists, add:

```json
{
  "scripts": {
    "check-skills": "node commands/check-skills.js --dirs skills"
  }
}
```

Otherwise skip.

---

## Verification Checklist

- [ ] `node commands/check-skills.js --dirs skills` exits 0 with all skills passing
- [ ] `node tests/skill-safety-checker/structural-rules.test.js` passes
- [ ] `.github/workflows/skill-safety-check.yml` is valid YAML
- [ ] The `choosing-agent-mode` skill passes its own checker
- [ ] No credentials or PII in any skill file
