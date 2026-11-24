#!/usr/bin/env bash
# Packages the VSIX, unpacks it into an empty directory without node_modules and runs the
# ground-truth gate against the bundle, so engines that break only once bundled fail CI.
set -euo pipefail

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT

npx vsce package --out "$dir/allyproof.vsix"
unzip -q "$dir/allyproof.vsix" -d "$dir/vsix"

# One universal VSIX: a native binary would tie it to one platform
native=$(find "$dir/vsix" -name '*.node')
if [ -n "$native" ]; then
    echo "Native binaries in the VSIX:"; echo "$native"; exit 1
fi

# The notices generated from the bundle ship with it
grep -q "W3C Software And Document" "$dir/vsix/extension/dist/THIRD-PARTY-NOTICES.txt" \
    || { echo "THIRD-PARTY-NOTICES.txt with the W3C notice missing from the VSIX"; exit 1; }

npm run test:gate -- --bundle "$dir/vsix/extension"

# The command line in the VSIX, run as a user or CI runs it
ALLYPROOF_CLI="$dir/vsix/extension/dist/cli.mjs" npm run test:cli

# The npm package of the command line, packed and unpacked without node_modules: every case through its MCP server
# must score exactly as the source does
npx ts-node scripts/npm-package.ts
npm pack ./out/npm --pack-destination "$dir" --silent > "$dir/tarball"
mkdir "$dir/npm"
tar -xzf "$dir/$(cat "$dir/tarball")" -C "$dir/npm"
npm run test:gate -- --mcp "$dir/npm/package/cli.mjs"
