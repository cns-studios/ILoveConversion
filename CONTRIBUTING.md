# Contributing to ILoveConversion

Thanks for your interest in contributing! This guide explains how to report problems, propose changes and get a pull request merged.

## Ground Rules

- **Security issues**: do not file them publicly. Follow [SECURITY.md](SECURITY.md).
- Be respectful and constructive in issues and reviews.
- Privacy is a core feature. Changes must not weaken encryption at rest, write unencrypted user data to persistent storage, or add tracking or third-party requests without prior discussion.

## Reporting Bugs and Requesting Features

Open a [GitHub issue](https://github.com/cns-studios/ILoveConversion/issues) and include:

- What you did, what you expected and what happened
- The file type and operation involved (never attach files containing private data)
- Relevant logs (`docker compose logs api worker`), with secrets removed
- Your environment (browser, OS, Docker version) if relevant

## Proposing Changes

1. **Open an issue first for larger changes** (new features, new file formats, architecture or dependency changes) so we can agree on the approach before you spend time on it. Small fixes and documentation improvements can go straight to a pull request.
2. Fork the repository and create a branch from `main`, for example `fix-upload-timeout` or `add-bmp-output`.
3. Make your changes (see below).
4. Open a pull request against `main` describing what changed and why. Link the related issue.

Keep pull requests focused: one logical change per PR.

## Development Setup

Requirements: Docker with Compose. Go 1.22+ is helpful for working on the backend directly.

```bash
git clone https://github.com/<your-username>/ILoveConversion.git
cd ILoveConversion
cp .env.example .env
# set POSTGRES_PASSWORD and ENCRYPTION_MASTER_KEY (openssl rand -hex 32)
docker compose up -d --build
```

The site is served at `http://localhost:5823`.

### Project Layout

| Path | Contents |
|---|---|
| `cmd/api`, `cmd/worker` | Entry points for the API gateway and the job worker |
| `internal/` | Config, crypto, database, models, processors, queue and storage packages |
| `rembg-service/` | Python background-removal service |
| `frontend/` | Static HTML, CSS and JS served by nginx |
| `nginx/`, `docker/`, `docker-compose.yml` | Deployment configuration |
| `legal/`, `scripts/build_legal.py` | Source and build script for the legal pages |

## Code Guidelines

- **Go**: run `gofmt` (or `go fmt ./...`) and `go vet ./...` before committing. Follow the style of the surrounding code and handle errors explicitly.
- **Frontend**: plain HTML, CSS and JavaScript. Match the existing structure and avoid adding build steps or heavy dependencies.
- **Python**: keep the rembg service small and dependency-light.
- Do not commit secrets, `.env` files or real user data.
- Update `README.md`, `.env.example` and the files in `legal/` when behavior, configuration or data handling changes. If you edit `legal/`, regenerate the pages with `scripts/build_legal.py`.
- Verify your change works with `docker compose up --build` and, where possible, by exercising the affected conversion end to end.

## Commit Messages

Write short, imperative messages that explain the change, for example `limit chunk size on upload` or `fix pdf preset mapping`.

## Pull Request Checklist

- [ ] The change is focused and builds with `docker compose up --build`
- [ ] Code is formatted (`gofmt`) and passes `go vet ./...`
- [ ] Docs and `.env.example` are updated if needed
- [ ] No secrets or personal data are included
- [ ] Privacy and security implications were considered

## License

ILoveConversion is licensed under the [GNU Affero General Public License v3.0](LICENSE). By submitting a contribution you agree that it will be licensed under the same terms.
