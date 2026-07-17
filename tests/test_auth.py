import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from mh import create_app


def make_app(monkeypatch, tmp_path, password=None):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/test.db")
    monkeypatch.setenv("CLEARINGHOUSE", "mock")
    monkeypatch.setenv("CRON_TOKEN", "testtoken")
    if password is None:
        monkeypatch.delenv("STAFF_PASSWORD", raising=False)
    else:
        monkeypatch.setenv("STAFF_PASSWORD", password)
    app = create_app()
    app.config["TESTING"] = True
    return app


def test_open_access_when_no_password(monkeypatch, tmp_path):
    http = make_app(monkeypatch, tmp_path).test_client()
    assert http.get("/").status_code == 200


def test_pages_redirect_to_login_when_password_set(monkeypatch, tmp_path):
    http = make_app(monkeypatch, tmp_path, password="s3cret").test_client()
    for path in ("/", "/clients/new", "/clients/1"):
        response = http.get(path)
        assert response.status_code == 302
        assert "/login" in response.headers["Location"]


def test_wrong_password_rejected(monkeypatch, tmp_path):
    http = make_app(monkeypatch, tmp_path, password="s3cret").test_client()
    page = http.post("/login", data={"password": "nope"})
    assert page.status_code == 200
    assert b"Wrong password" in page.data
    assert http.get("/").status_code == 302


def test_correct_password_grants_access_and_logout_revokes(monkeypatch, tmp_path):
    http = make_app(monkeypatch, tmp_path, password="s3cret").test_client()
    response = http.post("/login", data={"password": "s3cret"})
    assert response.status_code == 302
    assert http.get("/").status_code == 200
    http.post("/logout")
    assert http.get("/").status_code == 302


def test_cron_endpoint_uses_token_not_login(monkeypatch, tmp_path):
    http = make_app(monkeypatch, tmp_path, password="s3cret").test_client()
    # still refused without the token...
    assert http.post("/tasks/recheck").status_code == 403
    # ...but works with the token and no login session
    assert http.post("/tasks/recheck?token=testtoken").status_code == 200
