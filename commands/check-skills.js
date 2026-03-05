#!/usr/bin/env node
/**
 * commands/check-skills.js
 *
 * Discover and validate all skills in the specified directories.
 *
 * Usage:
 *   node commands/check-skills.js [--dirs dir1 dir2 ...] [--ci]
 *
 * Options:
 *   --dirs  One or more directories to scan (default: ./skills)
 *   --ci    Emit GitHub Actions annotations in addition to console output
 *
 * Exit codes:
 *   0  All skills pass (errors = 0)
 *   1  One or more skills have error-severity violations
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSkillsInDir } from '../lib/skills-core.js';
import { validate } from '../lib/skill-safety-checker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot   = path.resolve(__dirname, '..');

// ---- Argument parsing -------------------------------------------------------
const args    = process.argv.slice(2);
const ciMode  = args.includes('--ci');
const dirsIdx = args.indexOf('--dirs');

const dirs = dirsIdx !== -1
    ? args.slice(dirsIdx + 1).filter(a => !a.startsWith('--'))
    : [path.join(repoRoot, 'skills')];

// ---- Skill discovery --------------------------------------------------------
const allSkills = [];
for (const dir of dirs) {
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) {
        console.warn(`⚠️  Directory not found: ${resolved}`);
        continue;
    }
    const found = findSkillsInDir(resolved, 'check');
    allSkills.push(...found);
}

if (allSkills.length === 0) {
    console.log('No skills found in specified directories.');
    process.exit(0);
}

const allSkillNames = allSkills.map(s => s.name);

// ---- Validation -------------------------------------------------------------
console.log(`Checking ${allSkills.length} skill${allSkills.length !== 1 ? 's' : ''}...\n`);

let totalWarn = 0;
let totalFail = 0;

for (const skill of allSkills) {
    const content = fs.readFileSync(skill.skillFile, 'utf8');
    const issues  = validate(content, skill.skillFile, allSkillNames);

    const errors   = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');

    // Status line
    if (errors.length > 0) {
        const ePlural = errors.length !== 1 ? 's' : '';
        const wPlural = warnings.length !== 1 ? 's' : '';
        console.log(`❌  ${skill.name.padEnd(32)} (${errors.length} error${ePlural}, ${warnings.length} warning${wPlural})`);
        totalFail++;
    } else if (warnings.length > 0) {
        const wPlural = warnings.length !== 1 ? 's' : '';
        console.log(`⚠️   ${skill.name.padEnd(32)} (${warnings.length} warning${wPlural})`);
        totalWarn++;
    } else {
        console.log(`✅  ${skill.name.padEnd(32)} (0 issues)`);
    }

    // Issue details
    for (const iss of issues) {
        const icon = iss.severity === 'error' ? '   ❌' : '   ⚠️ ';
        console.log(`${icon} ${iss.ruleId.padEnd(4)} ${iss.message}`);

        if (ciMode) {
            const level = iss.severity === 'error' ? 'error' : 'warning';
            // GitHub Actions annotation format
            console.log(`::${level} file=${iss.filePath},line=${iss.line}::${iss.ruleId}: ${iss.message}`);
        }
    }
}

// ---- Summary ----------------------------------------------------------------
const total     = allSkills.length;
const totalPass = total - totalFail - totalWarn;

console.log(`\nSummary: ${total} skill${total !== 1 ? 's' : ''}, ${totalPass} pass, ${totalWarn} warn, ${totalFail} fail`);

if (totalFail > 0) {
    process.exit(1);
}
