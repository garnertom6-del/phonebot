#!/bin/bash
# SessionStart hook -- prepare a fresh Claude Code on the web container.
#
# A remote session starts from a clean image: the repo is cloned, but nothing is
# installed. Without this hook every session begins by discovering the same
# missing dependencies. Everything here is idempotent, so a warm container
# re-runs it cheaply.
set -euo pipefail

# Local machines already have their own setup (see .cursor/install.sh); only the
# remote containers start empty.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

log() { printf '  %s\n' "$*"; }

# --------------------------------------------------------------- python ---
# Install into a virtualenv, not the system interpreter. Several of the base
# image's Python packages are Debian-managed and carry no RECORD file, so pip
# cannot upgrade them: installing flask system-wide dies on "Cannot uninstall
# blinker 1.7.0". A venv owns its own copies and sidesteps the whole class of
# conflict. .venv/ is gitignored, and .cursor/install.sh already does the same
# thing for local machines.
echo "== Python dependencies =="
VENV="$PWD/.venv"
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
  log "created .venv"
fi

# Root Flask phone assistant.
if [ -f requirements.txt ]; then
  "$VENV/bin/python" -m pip install --quiet --disable-pip-version-check \
    -r requirements.txt
  log "requirements.txt installed"
fi

# The NC SAIOP/PSR licensure engine (skills/nc-saiop-psr-licensure-packet)
# shells out to python3 directly, so these must be on the session's PATH:
#   python-docx   the Policy & Procedure manual and training booklets
#   reportlab     the certificates, drawn straight to PDF
#   PyMuPDF       page measurement and rendering
#   openpyxl      the ASAM 27G .4400 waiver workbook
#   pypdf         PDF assembly
#   pdfminer.six  find_pages.py, which reads the TOC page numbers back out
"$VENV/bin/python" -m pip install --quiet --disable-pip-version-check \
  python-docx reportlab PyMuPDF openpyxl pypdf pdfminer.six
log "licensure engine dependencies installed"

# Put the venv first on PATH for the whole session, so a bare `python3` -- what
# build_provider.py invokes for every step -- resolves to this interpreter.
# Guarded so repeated runs do not keep appending to the env file.
if [ -n "${CLAUDE_ENV_FILE:-}" ] \
   && ! grep -qF "$VENV/bin" "$CLAUDE_ENV_FILE" 2>/dev/null; then
  echo "export PATH=\"$VENV/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
  log "added .venv/bin to the session PATH"
fi

# ---------------------------------------------------------- libreoffice ---
# The licensure engine converts DOCX to PDF with soffice, then reads real page
# numbers out of that PDF to fill the DHSR worksheet -- a step its own run order
# calls non-negotiable. libreoffice-core ALONE IS NOT ENOUGH: without the writer
# component there is no filter to load a .docx, so soffice answers "source file
# could not be loaded" for every file, produces no PDF, and the worksheet cannot
# be filled. The failure is silent, which is what makes it worth pinning here.
echo "== LibreOffice =="
missing_lo=""
for pkg in libreoffice-writer libreoffice-calc; do
  dpkg -s "$pkg" >/dev/null 2>&1 || missing_lo="$missing_lo $pkg"
done
if [ -n "$missing_lo" ]; then
  # The image ships a stale package index; without this refresh the archive
  # URLs 404 and the install fails.
  $SUDO apt-get update -qq
  # shellcheck disable=SC2086
  $SUDO apt-get install -y -qq $missing_lo
  log "installed:$missing_lo"
else
  log "libreoffice-writer and libreoffice-calc already present"
fi

# ------------------------------------------------------------------ node ---
echo "== Smart Intake (Next.js) =="
if [ -f smart-intake/package.json ]; then
  # prisma reads DATABASE_URL from .env at generate time, and npm install runs
  # `prisma generate` in postinstall. Local dev is SQLite with no external
  # services; .env is gitignored. Mirrors .cursor/install.sh.
  if [ ! -f smart-intake/.env ]; then
    cat > smart-intake/.env <<'ENV'
DATABASE_URL="file:./dev.db"
SESSION_SECRET="dev-local-secret-not-for-production-use-000000000000"
APP_BASE_URL="http://localhost:3000"
CLIENT_LINK_EXPIRY_DAYS="7"
ENV
    log "wrote smart-intake/.env for local dev"
  fi
  # install, not ci -- the container image is cached after this hook completes,
  # so a warm start reuses node_modules instead of rebuilding it.
  #
  # The registry connection drops often enough to matter (ECONNRESET mid
  # transfer), so retry rather than failing the session over a blip. npm's own
  # fetch retries cover a single request; the loop covers a whole run dying
  # partway through.
  npm_install_with_retry() {
    local attempt
    for attempt in 1 2 3; do
      if npm install --no-audit --no-fund --loglevel=error \
           --fetch-retries=5 --fetch-retry-maxtimeout=120000; then
        return 0
      fi
      log "npm install failed (attempt ${attempt}/3); retrying in $((attempt * 5))s"
      sleep "$((attempt * 5))"
    done
    return 1
  }

  # Deliberately not fatal. Python and LibreOffice are already in place by this
  # point, so the licensure packet builder works even when the npm registry is
  # having a bad day; failing the whole hook here would block the session for a
  # dependency the current task may not touch.
  if ( cd smart-intake && npm_install_with_retry ); then
    log "npm dependencies installed"

    # node_modules alone is not enough to run the tests: scripts/test.ts talks
    # to the SQLite database, so without the schema it fails partway through
    # with "The table main.User does not exist in the current database".
    # db:push creates the schema, seed fills it -- the same pair
    # .cursor/install.sh runs, and what package.json's prestart does before
    # `npm start`. Both are idempotent.
    if ( cd smart-intake && npm run db:push --silent && npm run seed --silent ); then
      log "database schema pushed and seeded"
    else
      log "WARNING: database setup did not complete. Run"
      log "         'cd smart-intake && npm run db:push && npm run seed'."
    fi
  else
    log "WARNING: npm install did not complete. Python-side tooling is ready;"
    log "         run 'cd smart-intake && npm install' before the Node tests."
  fi
fi

echo "== Ready =="
