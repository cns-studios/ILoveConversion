# Security Policy

ILoveConversion handles user-supplied files, so we take security reports seriously. Thank you for helping keep the project and its users safe.

## Supported Versions

There are no tagged releases. Security fixes are applied to the latest `main` branch and to the hosted instance at <https://ilc.cns-studios.com>. Self-hosted deployments should update to the latest `main`.

## Reporting a Vulnerability

**Please do not open a public issue, pull request or discussion for security problems.**

Report privately through GitHub:

1. Go to the [Security tab](https://github.com/cns-studios/ILoveConversion/security) of the repository.
2. Click **Report a vulnerability**.
3. Describe the issue.

Please include, where possible:

- The affected component (API, worker, rembg service, nginx config, frontend, Docker setup)
- Steps to reproduce or a proof of concept
- The impact you expect (for example data exposure, code execution, denial of service)
- The commit or date you tested against

## What to Expect

- **Acknowledgement** within 72 hours.
- **Assessment and updates** as we triage the report. We will tell you whether we consider it a valid vulnerability.
- **Fix and disclosure** within 90 days of the report. We will coordinate the disclosure date with you and credit you in the advisory unless you prefer to stay anonymous.

Please give us the time above to fix the issue before disclosing it publicly.

## Scope

In scope:

- The Go API and worker (`cmd/`, `internal/`)
- The encryption and key-derivation code (`internal/crypto`)
- The rembg service (`rembg-service/`)
- The frontend, nginx configuration and Docker setup in this repository
- The hosted instance at <https://ilc.cns-studios.com>, for issues in this project's own code and configuration

Examples of issues we are interested in: access to other users' files or jobs, weaknesses in the encryption at rest, path traversal, upload handling flaws, command injection into `ffmpeg`, `ghostscript`, `qpdf` or `libvips`, SSRF, rate-limit bypass, and unencrypted data leaking outside the tmpfs sandbox.

Out of scope:

- Vulnerabilities in third-party tools or libraries themselves (report those upstream), unless our usage makes them exploitable
- Denial of service through sheer volume of traffic or large resource-heavy uploads within the configured limits
- Social engineering, physical attacks, and attacks on infrastructure we do not operate
- Missing best-practice headers or configuration without a demonstrable impact
- Automated scanner output without a working proof of concept

## Safe Harbor

If you act in good faith, stay within the scope above, avoid accessing or destroying data that is not yours, and do not degrade the service for others, we will not pursue legal action over your research.

## Hardening Your Own Deployment

- Generate `ENCRYPTION_MASTER_KEY` with `openssl rand -hex 32` and keep it secret. Every job key is derived from it, so anyone who has it can decrypt stored files.
- Use a strong, unique `POSTGRES_PASSWORD`.
- Never commit your `.env` file.
- Run behind HTTPS and keep the host, Docker and base images up to date.
