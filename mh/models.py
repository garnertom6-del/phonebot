from datetime import datetime, timezone

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def utcnow():
    return datetime.now(timezone.utc)


class Client(db.Model):
    __tablename__ = "clients"

    id = db.Column(db.Integer, primary_key=True)
    first_name = db.Column(db.String(80), nullable=False)
    last_name = db.Column(db.String(80), nullable=False)
    dob = db.Column(db.Date, nullable=False)
    medicaid_id = db.Column(db.String(40), nullable=False)
    phone = db.Column(db.String(20))
    active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    checks = db.relationship(
        "EligibilityCheck",
        backref="client",
        lazy=True,
        order_by="EligibilityCheck.checked_at.desc()",
    )

    @property
    def latest_check(self):
        return self.checks[0] if self.checks else None


class EligibilityCheck(db.Model):
    __tablename__ = "eligibility_checks"

    id = db.Column(db.Integer, primary_key=True)
    client_id = db.Column(db.Integer, db.ForeignKey("clients.id"), nullable=False)
    checked_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    # active | inactive | review | error
    # "review" means the payer answered but the response could not be
    # confidently classified - a human should read raw_response.
    status = db.Column(db.String(16), nullable=False)

    payer_name = db.Column(db.String(120))
    plan_name = db.Column(db.String(120))
    # Standard Plan / Tailored Plan / NC Medicaid Direct / Unknown
    plan_type = db.Column(db.String(40))
    coverage_start = db.Column(db.String(20))
    coverage_end = db.Column(db.String(20))
    message = db.Column(db.String(400))
    raw_response = db.Column(db.Text)
    source = db.Column(db.String(20), nullable=False)  # mock | claimmd
