"""Staff login for the eligibility app.

Setting the STAFF_PASSWORD env var turns the login on: every page except
/login and the token-protected /tasks/ endpoints then requires signing in.
With STAFF_PASSWORD unset the app runs open for local development, and the
header shows a test-mode warning.
"""
import hmac
import os

from flask import Blueprint, redirect, render_template, request, session, url_for

bp = Blueprint("auth", __name__, template_folder="templates")

# /tasks/* endpoints authenticate with their own CRON_TOKEN instead.
EXEMPT_PREFIXES = ("/login", "/tasks/")


def password_required():
    return bool(os.environ.get("STAFF_PASSWORD"))


@bp.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        expected = os.environ.get("STAFF_PASSWORD", "")
        given = request.form.get("password", "")
        if expected and hmac.compare_digest(given.encode(), expected.encode()):
            session["logged_in"] = True
            return redirect(url_for("mh.client_list"))
        error = "Wrong password."
    return render_template("login.html", error=error)


@bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("auth.login"))


@bp.before_app_request
def require_login():
    if not password_required():
        return None
    if request.path.startswith(EXEMPT_PREFIXES) or request.path.startswith("/static"):
        return None
    if session.get("logged_in"):
        return None
    return redirect(url_for("auth.login"))
