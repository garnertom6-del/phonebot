import json
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from mh import create_app
from mh.clearinghouse import (
    ClaimMDClearinghouse,
    MockClearinghouse,
    classify_nc_plan,
    get_clearinghouse,
)
from mh.models import Client, EligibilityCheck, db


@pytest.fixture()
def app(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/test.db")
    monkeypatch.setenv("CLEARINGHOUSE", "mock")
    monkeypatch.setenv("CRON_TOKEN", "testtoken")
    application = create_app()
    application.config["TESTING"] = True
    return application


@pytest.fixture()
def http(app):
    return app.test_client()


def add_client(http, medicaid_id="ABC12345", last="Smith"):
    return http.post(
        "/clients/new",
        data={
            "first_name": "Pat",
            "last_name": last,
            "dob": "1990-05-02",
            "medicaid_id": medicaid_id,
        },
        follow_redirects=False,
    )


# ---------- mock clearinghouse behavior ----------

def test_mock_active():
    result = MockClearinghouse().check("Pat", "Smith", date(1990, 5, 2), "ABC12345")
    assert result.status == "active"
    assert result.plan_name


def test_mock_inactive_when_id_ends_in_zero():
    result = MockClearinghouse().check("Pat", "Smith", date(1990, 5, 2), "ABC12340")
    assert result.status == "inactive"


def test_mock_review_when_id_ends_in_nine():
    result = MockClearinghouse().check("Pat", "Smith", date(1990, 5, 2), "ABC12349")
    assert result.status == "review"


def test_mock_selected_when_no_account_key(monkeypatch):
    monkeypatch.delenv("CLEARINGHOUSE", raising=False)
    monkeypatch.delenv("CLAIMMD_ACCOUNT_KEY", raising=False)
    assert isinstance(get_clearinghouse(), MockClearinghouse)


# ---------- NC plan classification ----------

def test_classify_tailored_plan():
    plan, plan_type = classify_nc_plan("Coverage through TRILLIUM HEALTH RESOURCES")
    assert plan == "Trillium Health Resources"
    assert plan_type == "Tailored Plan"


def test_classify_standard_plan():
    plan, plan_type = classify_nc_plan("HEALTHY BLUE member")
    assert plan_type == "Standard Plan"


def test_classify_unknown():
    assert classify_nc_plan("something else") == (None, "Unknown")


# ---------- Claim.MD response parsing (no network) ----------

def make_claimmd():
    return ClaimMDClearinghouse("key", "1234567890", "NCMCD")


def test_parse_active_271():
    raw = json.dumps(
        {"elig": {"benefit": [{"benefit_code": "1", "benefit_description": "Active Coverage",
                               "plan": "HEALTHY BLUE"}]}}
    )
    result = make_claimmd()._parse(raw)
    assert result.status == "active"
    assert result.plan_type == "Standard Plan"


def test_parse_inactive_271():
    raw = json.dumps({"elig": {"benefit": [{"benefit_code": "6"}]}})
    assert make_claimmd()._parse(raw).status == "inactive"


def test_parse_garbage_goes_to_review_not_active():
    result = make_claimmd()._parse("<html>login page</html>")
    assert result.status == "review"
    assert result.raw_response


# ---------- web app flow ----------

def test_add_client_runs_first_check(app, http):
    response = add_client(http)
    assert response.status_code == 302
    with app.app_context():
        client = Client.query.one()
        assert client.latest_check is not None
        assert client.latest_check.status == "active"


def test_client_list_shows_status(app, http):
    add_client(http)
    page = http.get("/").get_data(as_text=True)
    assert "Smith, Pat" in page
    assert "active" in page


def test_check_now_adds_history_row(app, http):
    add_client(http)
    http.post("/clients/1/check")
    with app.app_context():
        assert EligibilityCheck.query.count() == 2


def test_recheck_requires_token(app, http):
    add_client(http)
    assert http.post("/tasks/recheck").status_code == 403
    assert http.post("/tasks/recheck?token=wrong").status_code == 403


def test_recheck_skips_recent_and_inactive(app, http):
    add_client(http)                          # checked just now -> skipped
    add_client(http, medicaid_id="XYZ777", last="Jones")
    http.post("/clients/2/toggle-active")     # inactive client -> not considered
    result = http.post("/tasks/recheck?token=testtoken").get_json()
    assert result == {"checked": 0, "skipped": 1, "date": result["date"]}
