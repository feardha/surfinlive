import os, sys, sqlite3, tempfile, shutil
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

@pytest.fixture
def app(tmp_path):
    db = tmp_path / "test.db"
    # copy schema + seed from the real DB's schema only
    src = sqlite3.connect(os.path.join(ROOT, "Event.db"))
    dst = sqlite3.connect(str(db))
    for row in src.execute("SELECT sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL").fetchall():
        try:
            dst.execute(row[0])
        except Exception:
            pass
    dst.commit()
    # seed one admin user with scrypt hash
    from werkzeug.security import generate_password_hash
    dst.execute("""INSERT INTO users (user_id,name,email,role_id,role_name,pw_hash,created_at,updated_at,updated_by)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                ("US0001","Admin","admin@surfin.live",1,"administrator",
                 generate_password_hash("adminpass", method="pbkdf2:sha256:5000"),
                 "2026-01-01","2026-01-01","admin"))
    dst.commit()
    src.close(); dst.close()

    os.environ["SL_DB_PATH"] = str(db)
    os.environ["SL_DEV_MOCK"] = "0"
    import importlib, api_server
    importlib.reload(api_server)
    api_server.app.config["TESTING"] = True
    yield api_server.app

@pytest.fixture
def client(app):
    return app.test_client()
