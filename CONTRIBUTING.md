# Contributing to n8n-2-octoPrint

Thanks for your interest! Bug reports, ideas, docs, and PRs are all welcome.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug** or **request a feature** — open an
  [issue](https://github.com/amosroger91/n8n-2-octoPrint/issues) (templates
  provided).
- **Improve docs** — even a typo fix is a good first PR.
- **Send code** — fix a bug, add a printer profile, add an auth provider, etc.

## Project layout

This is a monorepo of **independent** Node.js / TypeScript packages — there are
no workspaces, so each builds on its own:

| Path | What |
| --- | --- |
| `n8n-nodes-octoprint/` | the n8n community node package |
| `octoprint2n8n/` | the OctoPrint ⇄ n8n bridge |
| `print-orchestrator/` | the print-farm worker + dashboard |
| `octoprint-emulator/` | a virtual OctoPrint for testing |
| `demo/`, `scripts/` | the full local demo + verification scripts |

## Dev setup

Requires **Node 20+** and (for the Docker bits) Docker.

```bash
git clone https://github.com/amosroger91/n8n-2-octoPrint.git
cd n8n-2-octoPrint/<package>
npm install
npm run build
```

## Testing

- **No hardware needed** — the emulator covers the protocol:
  ```bash
  cd octoprint-emulator && npm i && npm run build && cd ..
  cd octoprint2n8n     && npm i && npm run build && cd ..
  node scripts/e2e.mjs
  ```
- **Against real OctoPrint / n8n** — see [`demo/`](demo/README.md) and the
  `scripts/verify-*.mjs` checks.
- **Orchestrator** — `print-orchestrator/stage-a.mjs` (print path) and
  `dashboard-test.mjs` (auth + status), with Redis + an OctoPrint reachable.

Please make sure the relevant package builds (`npm run build`) and any related
test script passes before opening a PR. CI builds every package, runs the e2e
test, and builds the Docker images.

## Coding conventions

- **TypeScript, `strict` mode.** Keep it strict-clean.
- **Match the surrounding style** (tabs for indentation, the existing logging /
  error-handling patterns). There's no enforced formatter — just keep diffs
  consistent with the file you're editing.
- **Minimal dependencies.** These services lean on Node built-ins (`node:http`,
  `node:crypto`, global `fetch`/`FormData`) on purpose. Add a dependency only
  when it genuinely earns its place, and say why in the PR.
- Keep packages independent — don't introduce cross-package imports.

## Pull requests

1. Branch off `main`.
2. Keep each PR to one logical change; write a clear description (what + why).
3. Link any related issue.
4. Make sure CI is green.

Small, focused PRs get reviewed fastest. If you're planning something large,
open an issue first so we can align on the approach.

## License

By contributing, you agree your contributions are licensed under the
project's [MIT License](LICENSE).
