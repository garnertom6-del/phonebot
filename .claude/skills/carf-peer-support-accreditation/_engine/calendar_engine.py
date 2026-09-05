"""Expand the obligation registry into concrete, dated instances.

This is what turns "you must run fire drills quarterly" into "Fire drill — Evening
shift — due 2027-03-31 — OVERDUE by 12 days". Nothing here invents a completion;
it only computes what is DUE and when, and reports status against today.
"""
import json
import os
from datetime import date, timedelta

ENGINE = os.path.dirname(os.path.abspath(__file__))

PERIODS = {"monthly": 1, "quarterly": 3, "semiannual": 6, "annual": 12}
EVENT_FREQS = {"per_event", "per_hire", "per_separation", "per_person"}


def _parse(d, default=None):
    if not d:
        return default
    try:
        parts = [int(x) for x in str(d).split("-")]
        if len(parts) == 2:
            parts.append(1)
        return date(*parts)
    except Exception:
        return default


def _add_months(d, n):
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    day = min(d.day, [31, 29 if y % 4 == 0 and (y % 100 or y % 400 == 0) else 28,
                      31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1])
    return date(y, m, day)


def load_obligations():
    with open(os.path.join(ENGINE, "content", "meta", "obligations.json")) as f:
        return json.load(f)


def multipliers(ob, provider):
    """Return the list of instance labels this obligation splits into."""
    if ob.get("shift_specific"):
        return provider.get("shifts") or ["All service hours"]
    if ob.get("site_specific"):
        sites = provider.get("sites") or []
        return sites or ["Main site"]
    if ob.get("vehicle_specific"):
        v = provider.get("vehicles") or []
        if isinstance(v, int):
            v = [f"Vehicle {i + 1}" for i in range(v)]
        return v or ["Vehicle 1"]
    if ob.get("per_person"):
        return [s.get("name") or s.get("role") or "Staff member"
                for s in (provider.get("staff") or [])] or ["Each direct service employee"]
    return [None]


def applicable(ob, provider):
    cond = ob.get("conditional")
    return True if not cond else bool(provider.get(cond))


def expand(provider, horizon_months=18, today=None):
    """Build every dated instance from cycle_start out to the horizon."""
    today = today or date.today()
    data = load_obligations()
    start = (_parse(provider.get("cycle_start"))
             or _parse(provider.get("six_months_of_data_start"))
             or _parse(provider.get("effective_date"))
             or date(today.year, 1, 1))
    survey = _parse(provider.get("target_survey_month"))
    end = _add_months(start, horizon_months)

    rows = []
    for ob in data["obligations"]:
        if not applicable(ob, provider):
            continue
        freq = ob["frequency"]
        labels = multipliers(ob, provider)

        if freq in PERIODS:
            step = PERIODS[freq]
            i = 0
            while True:
                period_start = _add_months(start, i * step)
                if period_start > end:
                    break
                due = _add_months(period_start, step) - timedelta(days=1)
                for lab in labels:
                    rows.append(_row(ob, due, lab, _period_name(freq, period_start, step)))
                i += 1

        elif freq == "once_before_survey":
            # Anchor to the survey month; the mock survey needs a 60-day runway.
            if survey:
                due = _add_months(survey, 1) - timedelta(days=1)
                if ob["id"] in ("SUR-06", "SUR-07", "SUR-08", "SUR-09"):
                    due = due - timedelta(days=60)
                if ob["id"] in ("SUR-01", "SUR-02", "SUR-03"):
                    due = _add_months(due, -9)
            else:
                due = None
            for lab in labels:
                rows.append(_row(ob, due, lab, "Before survey"))

        elif freq == "once_after_survey":
            due = _add_months(survey, 4) - timedelta(days=1) if survey else None
            rows.append(_row(ob, due, None, "After survey"))

        elif freq in EVENT_FREQS:
            for lab in labels:
                rows.append(_row(ob, None, lab, _event_label(freq)))
    rows.sort(key=lambda r: (r["due"] or date(2099, 1, 1), r["id"]))
    return _status(rows, today), start, end


def _period_name(freq, period_start, step):
    if freq == "monthly":
        return period_start.strftime("%b %Y")
    if freq == "quarterly":
        return f"Q{(period_start.month - 1) // 3 + 1} {period_start.year}"
    if freq == "semiannual":
        return f"H{(period_start.month - 1) // 6 + 1} {period_start.year}"
    return f"Year to {_add_months(period_start, step).strftime('%b %Y')}"


def _event_label(freq):
    return {"per_event": "Each time it happens",
            "per_hire": "Each new hire",
            "per_separation": "Each separation",
            "per_person": "Each person served / each employee"}[freq]


def _row(ob, due, label, period):
    return {"id": ob["id"], "item": ob["item"], "area": ob["area"], "domain": ob["domain"],
            "owner": ob["owner"], "evidence": ob["evidence"], "frequency": ob["frequency"],
            "basis": ob.get("basis", ""), "note": ob.get("note", ""),
            "instance": label or "", "period": period, "due": due}


def _status(rows, today):
    for r in rows:
        d = r["due"]
        if d is None:
            r["status"] = "Ongoing — no fixed date"
            r["days"] = ""
        elif d < today:
            r["status"] = "OVERDUE"
            r["days"] = (today - d).days
        elif (d - today).days <= 30:
            r["status"] = "Due within 30 days"
            r["days"] = (d - today).days
        else:
            r["status"] = "Upcoming"
            r["days"] = (d - today).days
    return rows


def summarize(rows):
    """Counts by status and by domain, for the cover page of the calendar."""
    by_status, by_domain = {}, {}
    for r in rows:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
        d = by_domain.setdefault(r["domain"], {"total": 0, "overdue": 0})
        d["total"] += 1
        if r["status"] == "OVERDUE":
            d["overdue"] += 1
    return by_status, by_domain
