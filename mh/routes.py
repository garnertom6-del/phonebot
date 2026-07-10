import os
from datetime import date, datetime, timedelta, timezone

from flask import Blueprint, abort, redirect, render_template, request, url_for

from .clearinghouse import get_clearinghouse
from .models import Client, EligibilityCheck, db

bp = Blueprint("mh", __name__, template_folder="templates")

# Re-check active clients whose last check is older than this many days.
RECHECK_AFTER_DAYS = 25


def run_check(client):
    """Run one eligibility check and store the result. Returns the row."""
    result = get_clearinghouse().check(
        client.first_name, client.last_name, client.dob, client.medicaid_id
    )
    row = EligibilityCheck(
        client_id=client.id,
        status=result.status,
        payer_name=result.payer_name,
        plan_name=result.plan_name,
        plan_type=result.plan_type,
        coverage_start=result.coverage_start,
        coverage_end=result.coverage_end,
        message=result.message,
        raw_response=result.raw_response,
        source=result.source,
    )
    db.session.add(row)
    db.session.commit()
    return row


@bp.route("/")
def client_list():
    clients = Client.query.order_by(Client.last_name, Client.first_name).all()
    return render_template("clients.html", clients=clients)


@bp.route("/clients/new", methods=["GET", "POST"])
def new_client():
    error = None
    if request.method == "POST":
        form = request.form
        try:
            dob = datetime.strptime(form["dob"], "%Y-%m-%d").date()
        except (ValueError, KeyError):
            dob = None
        if not (form.get("first_name") and form.get("last_name")):
            error = "First and last name are required."
        elif dob is None:
            error = "Date of birth is required (YYYY-MM-DD)."
        elif not form.get("medicaid_id"):
            error = "Medicaid ID is required."
        else:
            client = Client(
                first_name=form["first_name"].strip(),
                last_name=form["last_name"].strip(),
                dob=dob,
                medicaid_id=form["medicaid_id"].strip(),
                phone=form.get("phone", "").strip() or None,
            )
            db.session.add(client)
            db.session.commit()
            run_check(client)
            return redirect(url_for("mh.client_detail", client_id=client.id))
    return render_template("new_client.html", error=error)


@bp.route("/clients/<int:client_id>")
def client_detail(client_id):
    client = db.session.get(Client, client_id) or abort(404)
    return render_template("client_detail.html", client=client)


@bp.route("/clients/<int:client_id>/check", methods=["POST"])
def check_now(client_id):
    client = db.session.get(Client, client_id) or abort(404)
    run_check(client)
    return redirect(url_for("mh.client_detail", client_id=client.id))


@bp.route("/clients/<int:client_id>/toggle-active", methods=["POST"])
def toggle_active(client_id):
    client = db.session.get(Client, client_id) or abort(404)
    client.active = not client.active
    db.session.commit()
    return redirect(url_for("mh.client_detail", client_id=client.id))


@bp.route("/tasks/recheck", methods=["POST"])
def monthly_recheck():
    """Re-check every active client whose last check is stale.

    Call this from a scheduled job (e.g. a Render cron job) once a day:
        curl -X POST "https://<host>/tasks/recheck?token=$CRON_TOKEN"
    Clients checked within the last RECHECK_AFTER_DAYS days are skipped,
    so daily runs still produce roughly-monthly checks per client.
    """
    expected = os.environ.get("CRON_TOKEN")
    if not expected or request.args.get("token") != expected:
        abort(403)

    cutoff = datetime.now(timezone.utc) - timedelta(days=RECHECK_AFTER_DAYS)
    checked, skipped = 0, 0
    for client in Client.query.filter_by(active=True).all():
        last = client.latest_check
        last_at = last.checked_at if last else None
        if last_at is not None and last_at.tzinfo is None:
            last_at = last_at.replace(tzinfo=timezone.utc)
        if last_at is not None and last_at > cutoff:
            skipped += 1
            continue
        run_check(client)
        checked += 1
    return {"checked": checked, "skipped": skipped, "date": date.today().isoformat()}
