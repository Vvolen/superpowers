/**
 * tests/skill-safety-checker/structural-rules.test.js
 *
 * Tests for lib/skill-safety-checker.js
 * Run with: node tests/skill-safety-checker/structural-rules.test.js
 */
import { strict as assert } from 'node:assert';
import { validate } from '../../lib/skill-safety-checker.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ ${name}`);
        console.error(`     ${err.message}`);
        failed++;
    }
}

// ---------------------------------------------------------------------------
console.log('\nStructural rules (S01-S06)');

test('S01: fires when frontmatter is missing', () => {
    const issues = validate('no frontmatter here', 'fake/SKILL.md', []);
    assert.ok(issues.some(i => i.ruleId === 'S01'), 'expected S01');
});

test('S01: short-circuits — no other checks run without frontmatter', () => {
    const issues = validate('no frontmatter here', 'fake/SKILL.md', []);
    assert.strictEqual(issues.length, 1, 'only S01 should fire');
});

test('S02: fires when name field is missing', () => {
    const content = '---\ndescription: Use when something\n---\n# Skill';
    const issues = validate(content, 'fake/SKILL.md', []);
    assert.ok(issues.some(i => i.ruleId === 'S02'), 'expected S02');
});

test('S03: fires when name contains invalid characters', () => {
    const content = '---\nname: My Skill (v2)\ndescription: Use when something\n---\n# Skill';
    const issues = validate(content, 'fake/SKILL.md', []);
    assert.ok(issues.some(i => i.ruleId === 'S03'), 'expected S03');
});

test('S03: passes with valid lowercase-hyphen name', () => {
    const content = '---\nname: my-skill-v2\ndescription: Use when something\n---\n# Skill';
    const issues = validate(content, 'fake/SKILL.md', []);
    assert.ok(!issues.some(i => i.ruleId === 'S03'), 'S03 should not fire');
});

test('S04: fires when description field is missing', () => {
    const content = '---\nname: my-skill\n---\n# Skill';
    const issues = validate(content, 'fake/SKILL.md', []);
    assert.ok(issues.some(i => i.ruleId === 'S04'), 'expected S04');
});

test('S05: fires when frontmatter exceeds 1024 characters', () => {
    const longDesc = 'x'.repeat(1010);
    const content = `---\nname: my-skill\ndescription: ${longDesc}\n---\n# Skill`;
    const issues = validate(content, 'fake/SKILL.md', []);
    assert.ok(issues.some(i => i.ruleId === 'S05'), 'expected S05');
});

test('S05: does not fire for normal-length frontmatter', () => {
    const content = '---\nname: my-skill\ndescription: Use when something happens\n---\n# Skill';
    const issues = validate(content, 'fake/SKILL.md', []);
    assert.ok(!issues.some(i => i.ruleId === 'S05'), 'S05 should not fire');
});

test('S06: fires for unknown frontmatter key', () => {
    const content = '---\nname: my-skill\ndescription: Use when something\nwhen_to_use: yes\n---\n# Skill';
    const issues = validate(content, 'fake/SKILL.md', []);
    assert.ok(issues.some(i => i.ruleId === 'S06'), 'expected S06');
});

// ---------------------------------------------------------------------------
console.log('\nContent rules (C01, C03, C05, C06)');

test('C01: fires when description does not start with "Use when"', () => {
    const content = '---\nname: my-skill\ndescription: Helps you do things\n---\n# Skill';
    const issues = validate(content, 'fake/SKILL.md', []);
    assert.ok(issues.some(i => i.ruleId === 'C01'), 'expected C01');
});

test('C01: does not fire when description starts with "Use when"', () => {
    const content = '---\nname: my-skill\ndescription: Use when something needs doing\n---\n# Skill';
    const issues = validate(content, 'fake/SKILL.md', []);
    assert.ok(!issues.some(i => i.ruleId === 'C01'), 'C01 should not fire');
});

test('C05: fires when description contains first-person pronoun', () => {
    const content = '---\nname: my-skill\ndescription: Use when I need help\n---\n# Skill';
    const issues = validate(content, 'fake/SKILL.md', []);
    assert.ok(issues.some(i => i.ruleId === 'C05'), 'expected C05');
});

test('C03: fires when description exceeds 500 characters', () => {
    const longDesc = 'Use when ' + 'x'.repeat(500);
    const content = `---\nname: my-skill\ndescription: ${longDesc}\n---\n# Skill`;
    const issues = validate(content, 'fake/SKILL.md', []);
    assert.ok(issues.some(i => i.ruleId === 'C03'), 'expected C03');
});

// ---------------------------------------------------------------------------
console.log('\nSafety rules (T01, T02, T04)');

test('T01: fires when credential-like pattern is present', () => {
    const content = '---\nname: my-skill\ndescription: Use when something\n---\n# Skill\napi_key=ghp_abcdefghijklmnopqrstuvwxyz1234';
    const issues = validate(content, 'fake/SKILL.md', []);
    assert.ok(issues.some(i => i.ruleId === 'T01'), 'expected T01');
});

test('T02: fires when an email address is present', () => {
    const content = '---\nname: my-skill\ndescription: Use when something\n---\n# Skill\nContact: user@example.com for help.';
    const issues = validate(content, 'fake/SKILL.md', []);
    assert.ok(issues.some(i => i.ruleId === 'T02'), 'expected T02');
});

test('T04: fires when eval() appears in content', () => {
    const content = '---\nname: my-skill\ndescription: Use when something\n---\n# Skill\n```js\neval(userInput)\n```';
    const issues = validate(content, 'fake/SKILL.md', []);
    assert.ok(issues.some(i => i.ruleId === 'T04'), 'expected T04');
});

// ---------------------------------------------------------------------------
console.log('\nCross-reference rules (X01)');

test('X01: fires when superpowers:ref does not match any known skill', () => {
    const content = '---\nname: my-skill\ndescription: Use when something\n---\n# Skill\nSee superpowers:nonexistent-skill';
    const issues = validate(content, 'fake/SKILL.md', ['brainstorming', 'writing-plans']);
    assert.ok(issues.some(i => i.ruleId === 'X01'), 'expected X01');
});

test('X01: does not fire when superpowers:ref matches a known skill', () => {
    const content = '---\nname: my-skill\ndescription: Use when something\n---\n# Skill\nSee superpowers:brainstorming';
    const issues = validate(content, 'fake/SKILL.md', ['brainstorming', 'writing-plans']);
    assert.ok(!issues.some(i => i.ruleId === 'X01'), 'X01 should not fire');
});

test('X01: skips cross-ref check when allSkillNames is empty', () => {
    const content = '---\nname: my-skill\ndescription: Use when something\n---\n# Skill\nSee superpowers:nonexistent-skill';
    const issues = validate(content, 'fake/SKILL.md', []);
    assert.ok(!issues.some(i => i.ruleId === 'X01'), 'X01 should not fire without skill list');
});

// ---------------------------------------------------------------------------
console.log('\nClean skill produces no errors');

test('a well-formed skill produces no error-severity issues', () => {
    const content = [
        '---',
        'name: my-clean-skill',
        'description: Use when a task matches this skill\'s domain',
        '---',
        '',
        '# My Clean Skill',
        '',
        '## Overview',
        '',
        'A short description of the skill.',
    ].join('\n');

    const issues = validate(content, 'fake/SKILL.md', []);
    const errors = issues.filter(i => i.severity === 'error');
    assert.strictEqual(errors.length, 0, `unexpected errors: ${errors.map(i => i.ruleId).join(', ')}`);
});

// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
    process.exit(1);
}
