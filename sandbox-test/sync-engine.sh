#!/usr/bin/env sh
# Re-copy the main build's engine into this folder.
#
# sandbox-test/ is deployed with itself as the site root, so it cannot reach
# ../js/ at runtime and has to carry its own copy. Run this after ANY edit to
# ../js/game-engine.js, or the sandbox will be testing stale physics.
#
#   sh sandbox-test/sync-engine.sh
#
# Verify they match:  diff js/game-engine.js sandbox-test/js/game-engine.js
set -e
here=$(cd "$(dirname "$0")" && pwd)
cp "$here/../js/game-engine.js" "$here/js/game-engine.js"
echo "synced: js/game-engine.js -> sandbox-test/js/game-engine.js"
