# Project Agent Rules

This repository uses AB AI Development Framework 1.0.2.0.2.

## AB orchestration contract
- `ab-orchestrator` is the primary/default AB agent for this repository.
- The user should normally interact with `ab-orchestrator`; specialist `ab-*` agents are delegated by the orchestrator when useful.
- `ab-architect`, `ab-backend`, `ab-frontend`, `ab-database`, `ab-tester`, `ab-reviewer`, `ab-devops`, and `ab-docs` are specialist roles, not replacements for the primary orchestration flow.
- Analysis or planning requests must not silently become implementation work.
- Before declaring work complete, the orchestrator must collect appropriate quality-gate evidence and report anything that could not be verified.

## Mandatory project context
Before substantial work, read:
- `.ai/project/PROJECT_CONFIG.yaml`
- `.ai/project/PROJECT_CONTEXT.md`
- `.ai/project/ARCHITECTURE.md`
- `.ai/project/BUSINESS_RULES.md`
- `.ai/project/COMMANDS.md`
- `.ai/project/QUALITY_GATES.md`
- relevant ADRs under `.ai/project/decisions/`

## Local rules
- Preserve existing architecture unless refactor/migration is explicitly requested.
- Inspect `git status` before meaningful modifications and preserve unrelated/local-only changes.
- Never expose secrets or commit real `.env` files.
- Never execute production or destructive Git/DB actions without explicit human approval.
- Use configured quality gates before claiming completion.
- If this is an existing project, code is the initial source of truth when documentation is incomplete; update docs only after verification.
- Project-specific rules override generic framework preferences when they do not violate security/safety constraints.
