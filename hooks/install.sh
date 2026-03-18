#!/bin/sh
# Install project git hooks into .git/hooks/
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$REPO_ROOT" ]; then
    echo "Error: not inside a git repository."
    exit 1
fi

HOOKS_SRC="$REPO_ROOT/hooks"
HOOKS_DEST="$REPO_ROOT/.git/hooks"

for hook in "$HOOKS_SRC"/*; do
    name=$(basename "$hook")
    [ "$name" = "install.sh" ] && continue
    cp "$hook" "$HOOKS_DEST/$name"
    chmod +x "$HOOKS_DEST/$name"
    echo "Installed hook: $name"
done

echo "Done. Git hooks installed from hooks/ into .git/hooks/"
