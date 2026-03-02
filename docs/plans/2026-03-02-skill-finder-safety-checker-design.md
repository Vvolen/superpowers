# Scheduled Skill Finder & Safety Checker — Design

**Date:** 2026-03-02
**Status:** Complete — scaffolding implemented, design and implementation plans merged

---

## Overview

Build a scheduled system that (1) discovers all skills across configured directories, (2) validates each skill against quality and safety standards, and (3) surfaces actionable reports so maintainers and agents can keep the skills library healthy.

The system has two cooperating components:

| Component | Responsibility |
|-----------|---------------|
| **Skill Finder** | Enumerate every `SKILL.md` across superpowers and personal skill directories |
| **Safety Checker** | Validate each discovered skill against structural, content, and safety rules |

A GitHub Actions workflow ties the two together on a nightly schedule, and the same logic runs locally via a CLI command.

---

## Background & Motivation

As the skills library grows, quality can erode silently:

- Frontmatter goes missing or exceeds the 1024-character limit
- Descriptions summarize workflow instead of stating triggering conditions
- Skill names contain characters Claude's search cannot index
- Word counts bloat, degrading token efficiency
- Sensitive data (credentials, PII) accidentally lands in skill files
- Cross-references point to skills that no longer exist

None of these problems are caught at commit time. This system provides continuous, automated oversight.

---

## Agent Mode Comparison

A key architectural question is which agent mode to use during each phase of this project and during ongoing operation.

### Modes & Providers

| Mode | Provider | Strengths | Limitations |
|------|----------|-----------|-------------|
| **GitHub Copilot (Agent)** | GitHub / various models | Deep GitHub integration, PR-aware, can read repo context automatically | Less flexible for multi-file orchestration; skill system not directly supported |
| **Claude Code** | Anthropic Claude | Full filesystem access, plugin marketplace, Superpowers native, long-context | Requires local setup; costs per token |
| **Codex (CLI)** | OpenAI | Native `~/.agents/skills/` discovery, good for scripted/headless tasks | No plugin marketplace; manual bootstrap for some workflows |

### Repository Selection in Agent Mode

Each mode determines the working repository differently:

**GitHub Copilot Agent:**
- Repository is set by the open PR or issue being worked on in the GitHub UI
- Agent has read access to the repository contents via GitHub API
- Local filesystem is _not_ directly accessible unless a Codex sandbox is spun up

**Claude Code:**
- Repository is the directory Claude Code is launched in (or the worktree root)
- Skills use `CLAUDE_PLUGIN_ROOT` to locate plugin-relative paths
- `using-git-worktrees` skill creates isolated branches for parallel work

**Codex CLI:**
- Repository is the current working directory when Codex is invoked
- Skills live in `~/.agents/skills/superpowers/` (symlinked from the clone)
- Skill discovery is automatic; no plugin configuration required

### Mode Selection Guidance

```
┌──────────────────┬────────────────────────────────────────────────┐
│ Workflow phase   │ Recommended mode                               │
├──────────────────┼────────────────────────────────────────────────┤
│ Discovery        │ GitHub Copilot Agent (PR/issue context)         │
│                  │  OR Codex (headless scripting, local scans)     │
├──────────────────┼────────────────────────────────────────────────┤
│ Spec / Design    │ Claude Code (long-context, brainstorming skill) │
├──────────────────┼────────────────────────────────────────────────┤
│ Build / Implement│ Claude Code (TDD skill, subagent-driven-dev)    │
│                  │  OR Codex (scripted, repeatable tasks)          │
├──────────────────┼────────────────────────────────────────────────┤
│ CI / Scheduled   │ GitHub Actions + Codex or Node.js script        │
└──────────────────┴────────────────────────────────────────────────┘
```

**Practical rules:**
1. Use **Copilot Agent** when the task is scoped to a PR or GitHub issue and you want GitHub-aware context without a local environment.
2. Use **Claude Code** for anything requiring multi-file refactoring, new skill authoring, or the full Superpowers workflow (brainstorming → plan → TDD → review).
3. Use **Codex** for headless/automated tasks, CI pipelines, or when working in environments where the Claude Code plugin is not available.

---

## Architecture

```
superpowers/
├── lib/
│   ├── skills-core.js              # Existing: discovery + frontmatter parsing
│   └── skill-safety-checker.js     # NEW: validation rules
├── commands/
│   └── check-skills.js             # NEW: CLI entry point
├── .github/
│   └── workflows/
│       └── skill-safety-check.yml  # NEW: nightly scheduled run
└── docs/
    └── plans/
        └── 2026-03-02-skill-finder-safety-checker-design.md   (this file)
        └── 2026-03-02-skill-finder-safety-checker-implementation.md
```

### Data Flow

```
Schedule / CLI invocation
        │
        ▼
  Skill Finder
  (skills-core.findSkillsInDir)
        │
        ▼
  For each SKILL.md
        │
        ▼
  Safety Checker
  (skill-safety-checker.validate)
        │
        ├── PASS  → logged, counted
        └── FAIL  → issue object { skill, rule, severity, message }
                         │
                         ▼
                   Report Writer
                   (stdout + exit code + optional GitHub Annotations)
```

---

## Safety Checker Rules

### Structural Rules (FAIL = blocker)

| Rule ID | Check | Rationale |
|---------|-------|-----------|
| `S01` | Frontmatter present and parseable | Skill is undiscoverable without frontmatter |
| `S02` | `name` field present and non-empty | Required for skill invocation |
| `S03` | `name` matches `^[a-z0-9-]+$` | Ensures Claude search can index it |
| `S04` | `description` field present and non-empty | Required for auto-triggering |
| `S05` | Total frontmatter ≤ 1024 characters | Platform constraint (Claude Code) |
| `S06` | No unknown frontmatter keys | Only `name` and `description` supported |

### Content Rules (WARN = advisory)

| Rule ID | Check | Rationale |
|---------|-------|-----------|
| `C01` | `description` starts with "Use when" | CSO best practice |
| `C02` | `description` written in third person | Injected into system prompt |
| `C03` | `description` ≤ 500 characters | Token efficiency |
| `C04` | Total word count ≤ 500 (or ≤ 150 for frequently-loaded skills) | Token efficiency |
| `C05` | No first-person pronouns in description (`I`, `my`, `we`) | CSO requirement |
| `C06` | `description` does not summarize workflow steps | Prevents Claude shortcutting |
| `C07` | Cross-references use skill name only, not `@path` syntax | Avoids force-loading files |

### Safety Rules (FAIL = blocker)

| Rule ID | Check | Rationale |
|---------|-------|-----------|
| `T01` | No credential patterns (API keys, tokens, passwords) | No secrets in skills |
| `T02` | No PII patterns (email addresses, SSNs, phone numbers) | Privacy protection |
| `T03` | No hardcoded IP addresses or internal hostnames | Infrastructure safety |
| `T04` | No `eval()` or `exec()` calls in inline code examples | Security hygiene |

### Cross-Reference Rules (WARN = advisory)

| Rule ID | Check | Rationale |
|---------|-------|-----------|
| `X01` | All `superpowers:skill-name` references resolve to real skills | Broken references mislead agents |
| `X02` | `@file` references resolve to existing files | Broken file references fail silently |

---

## Scheduled Finder Behavior

The nightly run (`skill-safety-check.yml`):

1. Checks out the repository
2. Runs `node commands/check-skills.js --dirs skills`
3. Exits non-zero if any FAIL-severity issues exist
4. Emits GitHub Actions annotations for each issue
5. Optionally opens a GitHub issue summarizing new failures (future phase)

Local run (developer):
```bash
node commands/check-skills.js --dirs skills ~/.agents/skills/personal
```

---

## Report Format

### Console (default)

```
Checking 18 skills...

✅  brainstorming                 (0 issues)
✅  systematic-debugging          (0 issues)
⚠️  my-new-skill                  (2 warnings)
   C01  description should start with "Use when"
   C04  word count 612 exceeds 500 limit
❌  broken-skill                  (1 error)
   S01  missing or unparseable frontmatter

Summary: 18 skills, 15 pass, 2 warn, 1 fail
Exit code: 1  (blockers found)
```

### GitHub Annotations (CI mode)

```
::error file=skills/broken-skill/SKILL.md,line=1::S01: missing or unparseable frontmatter
::warning file=skills/my-new-skill/SKILL.md,line=3::C01: description should start with "Use when"
```

---

## Implementation Approaches Considered

### Option A: Standalone Node.js module (recommended)

- Extends existing `lib/skills-core.js` pattern
- No new runtime dependencies beyond Node.js built-ins
- Easy to run locally and in CI
- Consistent with `.codex/superpowers-codex` CLI architecture

### Option B: GitHub Action only

- Only runs in CI, no local workflow
- Harder to iterate on locally
- Rejected: developer experience is poor

### Option C: Separate Python service

- Adds a second language to the repo
- No benefit over Node.js given existing codebase
- Rejected: unnecessary complexity

**Recommendation: Option A.**

---

## Next Steps

1. Create implementation plan (`docs/plans/2026-03-02-skill-finder-safety-checker-implementation.md`)
2. Scaffold `lib/skill-safety-checker.js` with rule stubs
3. Scaffold `commands/check-skills.js` CLI
4. Create `.github/workflows/skill-safety-check.yml`
5. Write tests in `tests/` following existing pattern
6. Run against existing skills and fix any violations found
