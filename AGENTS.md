## Branches, Commits, and Pull Requests

- Use plain lowercase kebab-case for branch names. Keep names descriptive and do not include issue numbers, prefixes, or namespaces such as `feature/`, `fix/`, usernames, or agent names.
- Before every commit or amend, show the exact current diff and validation, then get explicit approval. Branch or pull-request requests are not commit approval; later changes require fresh approval.
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
- For bugs, describe the current and expected behavior. Include reproduction steps, environment details, and supporting evidence when available.
- For enhancements, explain the problem or goal, the desired outcome, and clear acceptance criteria.
- For UI issues, include screenshots. Include a short video when motion or interaction is relevant.
- Link any related issues and pull requests.
- Apply the appropriate existing label: `bug` for bugs, `enhancement` for feature requests, and `documentation` for documentation work.
