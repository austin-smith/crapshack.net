# crapshack.net Agent Guide

This file defines project constraints and working conventions for coding agents in this repository.

## Project Overview

- This repository contains the static Astro website published at `https://crapshack.net`.
- The site uses Astro 6, strict TypeScript, Tailwind CSS 4, and pnpm.
- Prefer static Astro markup and CSS. Add client-side JavaScript only when a feature requires browser interaction.

## Project Structure

- `src/pages/` contains routes. Keep route-specific content and composition in the relevant page.
- `src/layouts/` contains shared page layouts.
- `src/components/` contains reusable Astro components.
- `src/components/ui/` contains reusable interface primitives.
- `src/lib/` contains shared TypeScript utilities, including reusable browser behavior under `src/lib/ui/`.
- `src/styles/` contains global styles and design tokens.
- `public/` contains static assets copied into the production build.

When adding code:

- Reuse the shared layout, UI components, utilities, and design tokens before creating page-specific duplicates.
- Keep browser scripts small and narrowly scoped. Do not add a frontend framework for behavior that plain TypeScript can handle clearly.
- Preserve responsive behavior, semantic HTML, keyboard access, focus management, and reduced-motion support.
- Keep external links that open a new tab protected with `rel="noopener noreferrer"`.
- Do not edit generated or dependency directories such as `dist/`, `.astro/`, `node_modules/`, or `.pnpm-store/`.

## Setup and Development

From the repository root:

```bash
pnpm install
pnpm dev
```

The development server supports hot reload. `SITE_URL` may override the default production site URL when needed.

## Validation

Run both required automated checks:

```bash
pnpm lint
pnpm build
```

The production build is written to `dist/`. The repository does not currently have an automated test suite.

For UI changes, manually check the affected pages at relevant desktop and mobile sizes. Exercise keyboard behavior and reduced-motion preferences when the change affects interaction or animation. Prefer focused, meaningful validation over tests that only restate implementation details.

## Branches, Commits, and Pull Requests

- Use plain lowercase kebab-case for branch names. Keep names descriptive and do not include issue numbers, prefixes, or namespaces such as `feature/`, `fix/`, usernames, or agent names.
- Before every commit or amend, show the exact current diff and validation, then get explicit approval. A branch or pull-request request is not commit approval; later changes require fresh approval.
- Never amend, rebase, squash, reset, rewrite history, or force-push without explicit approval for that exact operation.
- Write commit messages entirely lowercase. Use the imperative mood for the subject, keep each commit focused on one logical change, do not use type or scope prefixes, and do not end the subject with a period. Add a body when the reason or important tradeoffs are not clear from the subject.
- Keep each pull request focused on one coherent change.
- Write concise, specific, imperative pull request titles in sentence case. Do not use prefixes or trailing periods, and make the title understandable without the branch name.
- Pull request descriptions must include `What Changed`, `Why`, and `Validation`. Include `UI Changes` only when the pull request changes the UI. Keep descriptions concise, self-contained, complete, and accurate to the final diff.
- Link any related issues in the pull request description; do not include issue numbers in branch names.
- Review the complete diff before opening a pull request. Update the title and description whenever the scope changes, and remove unrelated changes.

## Issues

- Search open and closed issues before creating a new issue.
- Keep each issue focused on one problem or change.
- Use a concise, specific, sentence-case title without type prefixes.
- Give enough context to understand the issue without first inspecting the code.
- For bugs, describe the current and expected behavior. Include reproduction steps, the affected page, browser and operating-system details, viewport or device information, and supporting evidence when available.
- For enhancements, explain the problem or goal, the desired outcome, and clear acceptance criteria.
- For UI issues, include screenshots. Include a short video when motion or interaction is relevant.
- Link any related issues and pull requests.
- Apply the appropriate existing label: `bug` for bugs, `enhancement` for feature requests, and `documentation` for documentation work.

## Build and Release

- GitHub Actions runs lint and the production build for pull requests and pushes to `main`.
- Pushing a tag matching `v*` runs the release workflow, builds `dist/`, archives it, and creates a GitHub release.
- Do not create or push version tags unless explicitly requested.
