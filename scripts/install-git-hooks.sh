#!/bin/sh
# Symlinks the repository's git hooks from scripts/git-hooks into .git/hooks.
# Hooks are linked individually (rather than setting core.hooksPath) so the
# Git LFS hooks already in .git/hooks keep working.
set -e

repo_root="$(git rev-parse --show-toplevel)"
hooks_dir="$(git rev-parse --git-path hooks)"

for hook in "$repo_root"/scripts/git-hooks/*; do
    name="$(basename "$hook")"
    ln -sf "$hook" "$hooks_dir/$name"
    echo "Installed $name hook"
done
