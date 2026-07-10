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

    db.init_app(app)

    from .routes import bp

    app.register_blueprint(bp)

    with app.app_context():
        db.create_all()

    return app
