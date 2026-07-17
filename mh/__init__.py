# mh/ - Mental health practice automation (Phase 1)
# This package is separate from the streaming-TV bot in app.py.
import os

from flask import Flask

from .models import db


def create_app():
    app = Flask(__name__)

    # SQLite by default for local/dev use. Point DATABASE_URL at Postgres
    # (on HIPAA-eligible hosting with a BAA) before storing real client data.
    app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get(
        "DATABASE_URL", "sqlite:///mh_practice.db"
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    # Signs the login session cookie. Render generates this; the local
    # fallback just means dev sessions reset when the app restarts.
    app.secret_key = os.environ.get("SECRET_KEY") or os.urandom(32)
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

    db.init_app(app)

    from . import auth
    from .routes import bp

    app.register_blueprint(auth.bp)
    app.register_blueprint(bp)

    @app.context_processor
    def auth_state():
        from flask import session

        protected = auth.password_required()
        return {
            "login_enabled": protected,
            "logged_in": not protected or session.get("logged_in", False),
        }

    with app.app_context():
        db.create_all()

    return app
