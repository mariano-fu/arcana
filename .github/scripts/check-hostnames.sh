#!/usr/bin/env bash
# Fails if a real Tailscale hostname is committed. The repo is public: the only allowed form is
# the placeholder `<host>.<tailnet>.ts.net`. The real node and tailnet names can't be listed
# here (that would publish them), so this rejects any other label in front of `.ts.net`.
set -euo pipefail

# A literal label right before `.ts.net` (e.g. `node.tail1234.ts.net`, `<host>.tail1234.ts.net`).
real_tailnet=$(git grep -n -I -E '[A-Za-z0-9_-]\.ts\.net' -- . ':!.github/scripts/check-hostnames.sh' || true)
# A node name in front of the tailnet placeholder (e.g. `mybox.<tailnet>.ts.net`).
real_node=$(git grep -n -I -E '[A-Za-z0-9_-]\.<tailnet>' -- . ':!.github/scripts/check-hostnames.sh' || true)

if [[ -n "$real_tailnet$real_node" ]]; then
  echo "Real Tailscale hostname found. Use the placeholder <host>.<tailnet>.ts.net instead:" >&2
  printf '%s\n' "$real_tailnet" "$real_node" | sed '/^$/d' >&2
  exit 1
fi
echo "No real Tailscale hostnames."
