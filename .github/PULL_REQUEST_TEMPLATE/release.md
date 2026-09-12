<!--
Release PR template. Use it with:
  gh pr create --template release.md
or by opening the PR at ...compare/main...release/X.Y.Z?template=release.md
Everyday PRs and Dependabot PRs do not use it.
-->

Version bump only — no functional change.

| Where | Change |
|---|---|
| `package.json`, `package-lock.json` | `A.B.C` → `X.Y.Z` |
| `manifest.json` | `A.B.C` → `X.Y.Z` (the .mcpb bundle) |
| `src/index.ts` | `Server` constructor version + stdio startup banner |
| `README.md`, `README.en.md` | vX.Y.Z changelog line, bundle download URLs pointed at the vX.Y.Z assets |

Earlier changelog lines stay as history.

## What ships in X.Y.Z

- <!-- one bullet per merged PR since the last tag: `git log vA.B.C..main --oneline` -->

<!-- Uncomment when the Node floor, a tool signature, or any other public contract changes.
## ⚠️ Breaking change

-->

## Verification

- [ ] `npm run typecheck`, `npm run build` → pass
- [ ] `npm run pack` → passes; its smoke test reads `X.Y.Z` from both the server and `package.json`, and the bundle contains no `typescript` / `@types/*` (`unzip -l releases/librelink-mcp-server.mcpb | grep -cE 'node_modules/(typescript|@types)/'` → `0`)
- [ ] `npm audit --audit-level=moderate` → 0 vulnerabilities

## After merge

```bash
git checkout main && git pull --ff-only
git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z
npm run pack
gh release create vX.Y.Z releases/librelink-mcp-server.mcpb releases/librelink-mcp-server.mcpb.sha256 \
  --title "LibreLink MCP Server vX.Y.Z" --latest --notes-file <notes>
```

`npm run pack` installs prod-only dependencies before packing (so dev dependencies never end up in the `.mcpb`), writes the `.sha256` in `sha256sum -c` format, and reinstalls dev dependencies afterwards. Verify the published assets with `gh release download vX.Y.Z -p 'librelink-mcp-server.mcpb*' && sha256sum -c librelink-mcp-server.mcpb.sha256`.
