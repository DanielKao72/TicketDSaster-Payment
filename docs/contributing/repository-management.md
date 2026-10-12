# Repository Management

This document defines how the Payment Service repository is organized and how contributions are expected to flow, so any team member can collaborate consistently.

## Branching Strategy

We use a simplified **Trunk-Based / GitHub Flow** model:

| Branch | Purpose |
|---|---|
| `main` | Always deployable. Protected branch. Every merge here should be releasable. |
| `develop` (optional, if the team needs an integration branch before `main`) | Aggregates finished features before a release. |
| `feature/<short-description>` | New functionality (e.g. `feature/payment-refund-endpoint`). |
| `fix/<short-description>` | Bug fixes (e.g. `fix/duplicate-payment-charge`). |
| `chore/<short-description>` | Maintenance tasks that don't change behavior (deps, CI, docs). |
| `hotfix/<short-description>` | Urgent fixes branched directly from `main`. |

> Branch names must be in **kebab-case** and describe the change, not the ticket number alone (e.g. `feature/payment-provider-webhook`, not `feature/DSASTER-123`).

## Commit Convention

We follow **Conventional Commits**:

```text
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

| Type | When to use it |
|---|---|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only changes |
| `style` | Formatting, missing semicolons, etc. (no logic change) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or fixing tests |
| `chore` | Build process, dependencies, tooling |

**Examples:**

```text
feat(payment): add refund endpoint
fix(provider): handle timeout on payment request
docs(readme): update setup instructions
chore(docker): bump node base image to 20-alpine
```

**Enforcement:** [commitlint](https://commitlint.js.org) (`@commitlint/config-conventional`) checks every message:

- **Locally:** a husky `commit-msg` hook rejects non-conforming commits. It is installed automatically by `npm install` in `payment-service/`.
- **In CI:** `.github/workflows/commitlint.yml` lints every commit of a PR to `main` or `develop` **and the PR title**, because the PR title becomes the squash commit message.

## Pull Request Workflow

1. Create a branch from `main` (or `develop` if applicable) following the naming convention above.
2. Commit using Conventional Commits.
3. Open a Pull Request early (draft PR is welcome) with a clear description:
   - **What** changed and **why**.
   - How to test it locally.
   - Screenshots/logs if relevant (e.g. Postman requests for new payment endpoints, using the provider's sandbox).
4. PR must pass:
   - Linting (`npm run lint`)
   - Tests (`npm test`)
   - Commitlint (PR commits and PR title)
   - Build of the Docker image
5. At least **one approval** is required before merging.
6. Use **Squash and Merge** into `main` to keep history clean — the squash commit message must follow Conventional Commits.
7. Delete the branch after merging.

## Protected Branch Rules (`main`)

- No direct pushes.
- Requires passing CI (lint + test + Docker build).
- Requires at least 1 review approval.
- Linear history enforced (squash merges only).