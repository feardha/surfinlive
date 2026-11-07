import pytest

def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.get_json()["ok"] is True

def test_login_missing_fields(client):
    r = client.post("/api/login", json={})
    assert r.status_code == 401

def test_login_invalid(client):
    r = client.post("/api/login", json={"email":"admin@surfin.live","password":"wrong"})
    assert r.status_code == 401

def test_login_success(client):
    r = client.post("/api/login", json={"email":"admin@surfin.live","password":"adminpass"})
    assert r.status_code == 200
    data = r.get_json()
    assert "user" in data
    assert data["user"]["email"] == "admin@surfin.live"
    assert "pw_hash" not in data["user"]

def test_session_requires_auth(client):
    r = client.get("/api/session")
    assert r.status_code in (401, 403)

def test_session_after_login(client):
    r = client.post("/api/login", json={"email":"admin@surfin.live","password":"adminpass"})
    token = r.get_json().get("token") or r.get_json().get("session_token")
    # try bearer + cookie flows by reusing client session (cookies auto)
    r2 = client.get("/api/session")
    assert r2.status_code == 200

def test_logout(client):
    client.post("/api/login", json={"email":"admin@surfin.live","password":"adminpass"})
    r = client.post("/api/logout")
    assert r.status_code in (200, 204)
    assert client.get("/api/session").status_code in (401, 403)
