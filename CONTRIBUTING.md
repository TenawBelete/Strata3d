# Contributing to Strata3d

Strata3d is developed through tracked issues and reviewed pull requests. Start by discussing substantial changes in an issue so the intended result and acceptance checks are clear.

## Work process

1. Choose or create an issue and agree on its scope with a maintainer.
2. Create a branch from the latest `main`. Use `feat/short-name`, `fix/short-name`, or `chore/short-name`.
3. Keep a branch focused on one issue. Do not commit directly to `main`.
4. Open a pull request that links the issue, describes the change, and lists checks performed.
5. Address review comments and wait for required checks before merging.

Project board statuses are **Created**, **Assigned**, **In progress**, **In review**, and **Solved**. A maintainer assigns work. Move an issue to **Solved** after the pull request is merged and its acceptance criteria are checked.

## Quality checks

For code changes, run the checks documented in the README and report their actual results. Do not claim a check passed if it was not run. Keep changes small enough to review and include a recovery or failure path when the code handles external services or generated assets.

For visual or movement changes, include before-and-after captures from the same camera position. Also show a moving view, such as a forward walk, sideways step, or turn. State the browser, route or scene URL, controls used, and any known visual defects. A passing build does not replace visual review.

## Dependencies and packages

Avoid adding a package when the existing project code or platform APIs can do the job. Every proposed dependency must be described in the pull request with:

- The problem it solves and why current project code is insufficient.
- Exact package name and version, registry or source, and direct or development-only use.
- License and any relevant attribution or redistribution requirements.
- Maintenance status and known security advisories checked.
- Bundle, runtime, and transitive dependency impact.

Do not install packages from unverified URLs or commit generated dependency directories. A maintainer reviews and approves dependency changes before merge.

## AI-assisted changes

Contributors may use AI tools, but remain responsible for the submitted code, assets, licenses, security, and test results. Disclose material AI-generated code or assets in the pull request and describe how they were checked. Do not submit project secrets, access tokens, private footage, or personal data to an external AI service.

## Assets and footage

For every new image, video, model, texture, or generated scene, provide its source, creator, capture date when known, license or written permission, processing steps, and a stable attribution. Do not commit raw footage unless the maintainer has approved its redistribution and repository storage impact. Keep generated scene outputs reproducible from documented inputs and tools where possible.

## Security

Never commit credentials, tokens, private keys, personal information, or local environment files. Use local environment configuration that is excluded from Git. Report vulnerabilities using the private process in [SECURITY.md](SECURITY.md).
