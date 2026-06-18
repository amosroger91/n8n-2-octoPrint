# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub's
[**Report a vulnerability**](https://github.com/amosroger91/n8n-2-octoPrint/security/advisories/new)
(Security → Advisories), or email **amosroger91@gmail.com** with details and, if
possible, a reproduction. You'll get an acknowledgement as soon as practical and
a fix or mitigation timeline once the report is triaged.

Please give a reasonable window to address the issue before any public
disclosure.

## Scope

This project moves printer telemetry and commands between OctoPrint and n8n and
drives prints. Relevant trust boundaries:

- **OctoPrint API key** — held by the bridge / orchestrator; never sent to n8n.
- **Shared secret** — HMAC-signs events and Bearer-authenticates commands.
- **Dashboard auth** — local scrypt-hashed credentials + HMAC session cookies;
  pluggable for external providers.

## What the code enforces

- **Bridge command proxy** — Bearer auth (timing-safe), an allow-list of
  OctoPrint resource roots, and path-traversal (`..`) rejection.
- **Orchestrator fetches** (STL / gcode / slicer output) — an SSRF guard: only
  `http`/`https`, never cloud-metadata addresses, and (optionally, via
  `ALLOW_PRIVATE_FETCH=false`) never private/loopback addresses. Redirects are
  not followed.
- **Dashboard** — scrypt-hashed credentials, HMAC-signed `HttpOnly` `SameSite`
  session cookies, and constant-work login (no user enumeration via timing).
- **Event signatures** — HMAC-SHA256 over the timestamp/nonce/event, with a
  freshness window on the n8n side.

## Hardening recommendations

- Run the bridge, orchestrator dashboard, and n8n **behind HTTPS**.
- Set a strong `BRIDGE_SHARED_SECRET`, `DASHBOARD_PASSWORD`, and `SESSION_SECRET`
  (`openssl rand -hex 32`).
- Keep secrets in the git-ignored `.env` files; never commit them.
- Restrict the bridge command proxy, the dashboard, and **Redis** to trusted
  networks.
- Prefer plain `http` for LAN OctoPrint. `OCTOPRINT_ALLOW_INSECURE_TLS=true`
  disables TLS verification **process-wide**, so only use it if you must.
