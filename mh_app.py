# mh_app.py - Entry point for the mental health practice system (Phase 1).
# Runs separately from the streaming-TV bot in app.py.
#
#   Local:      python mh_app.py            (mock eligibility, SQLite)
#   Production: gunicorn mh_app:app         (set env vars per ELIGIBILITY.md)
import os

from mh import create_app

app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5001)), debug=False)
