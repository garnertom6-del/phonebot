# intake.py - Client intake packet for Super Streaming TV.
# Asks the client a short set of questions, then auto-completes the full
# packet (service decision, install plan, payment plan) from their answers.
# The client signs electronically; the business countersignature is stamped
# automatically once every required decision is resolved.
import json
import os
import re
import uuid
from datetime import datetime, timezone

from flask import Blueprint, abort, redirect, render_template, request, url_for

intake_bp = Blueprint("intake", __name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "intakes")

BUSINESS_NAME = "Super Streaming TV"
DOWNLOADER_CODE = "9014088"

PAYMENT_OPTIONS = {
    "zelle": {"label": "Zelle", "send_to": "mtmarrs@live.com"},
    "chime": {"label": "Chime", "send_to": "$thomas-garner-47"},
    "cashapp": {"label": "Cash App", "send_to": "$solutions2027"},
}

SERVICE_TYPES = {
    "new": "New sign-up",
    "reactivation": "Reactivate my service",
    "add_device": "Add another device",
}

DEVICE_TYPES = {
    "firestick": "Firestick / Fire TV",
    "android": "Android box or phone",
    "smart_tv": "Smart TV",
    "other": "Other / not sure",
}


# ---------------------------------------------------------------------------
# Decision engine: every section of the packet is derived from the answers.
# ---------------------------------------------------------------------------

def _service_decision(a):
    service = a["service_type"]
    if service == "reactivation":
        return {
            "title": "Service decision: Reactivation",
            "lines": [
                "Your account will be reactivated within 10 minutes or less "
                "after your payment is confirmed.",
                "Account name on file: %s" % (a.get("account_name") or "(to be confirmed by phone)"),
            ]
            + (["Account number: %s" % a["account_number"]] if a.get("account_number") else []),
        }
    if service == "add_device":
        return {
            "title": "Service decision: Add a device",
            "lines": [
                "A device slot will be added to your existing account once "
                "payment is confirmed.",
                "Devices covered after this change: %s" % a["device_count"],
            ],
        }
    return {
        "title": "Service decision: New sign-up",
        "lines": [
            "A new account will be created under the name %s." % a["full_name"],
            "Service starts as soon as your first payment is confirmed "
            "and the app is installed (usually the same day).",
            "Devices covered: %s" % a["device_count"],
        ],
    }


def _install_decision(a):
    device = a["device_type"]
    if device == "smart_tv":
        return {
            "title": "Install plan: Smart TV",
            "lines": [
                "Smart TV setups vary by brand, so a team member will walk "
                "you through installation on a quick call.",
                "Have your TV on and connected to wifi before the call.",
            ],
        }
    if device == "other":
        return {
            "title": "Install plan: We'll help you directly",
            "lines": [
                "A team member will contact you to figure out the best way "
                "to get the app on your device.",
            ],
        }
    # Firestick / Fire TV or Android with the Downloader app path.
    steps = []
    if a.get("has_downloader") != "yes":
        if device == "firestick":
            steps += [
                "On your Firestick go to Settings, then My Fire TV (or Device "
                "& Software), then Developer Options, and turn ON Apps from "
                "Unknown Sources (or Install unknown apps).",
                "Search the Fire TV app store for the free Downloader app "
                "and install it.",
            ]
        else:
            steps += [
                "Install the free Downloader app from your device's app store.",
                "If prompted, allow installs from unknown sources for Downloader.",
            ]
    steps += [
        "Open Downloader, type %s, and click Go." % DOWNLOADER_CODE,
        "The download will be highlighted in blue - click it, choose "
        "Download anyway, then Install, then Open.",
    ]
    return {
        "title": "Install plan: %s" % DEVICE_TYPES[device],
        "lines": steps,
    }


def _payment_decision(a):
    method = PAYMENT_OPTIONS[a["payment_method"]]
    lines = [
        "Payment method: %s" % method["label"],
        "Send payment to: %s" % method["send_to"],
        "Monthly amount agreed: $%s" % a["monthly_amount"],
        "Include your name (%s) in the payment note so it matches your account." % a["full_name"],
    ]
    if a["service_type"] == "reactivation":
        lines.append("Reactivation happens within 10 minutes or less of a confirmed payment.")
    return {"title": "Payment plan", "lines": lines}


def _contact_decision(a):
    pref = "text message" if a["contact_pref"] == "text" else "phone call"
    return {
        "title": "How we'll reach you",
        "lines": [
            "Preferred contact: %s at %s." % (pref, a["phone"]),
        ]
        + (["Email on file: %s" % a["email"]] if a.get("email") else []),
    }


TERMS = [
    "Service is billed monthly at the amount listed in the Payment plan section.",
    "Service pauses if a monthly payment is missed and resumes within about "
    "10 minutes once payment is confirmed.",
    "Support is available through the %s phone line for install help, "
    "troubleshooting, and account questions." % BUSINESS_NAME,
    "The client is responsible for their own internet connection and device.",
]


def build_packet(a):
    """Resolve every decision in the packet from the client's answers."""
    return {
        "sections": [
            _service_decision(a),
            _install_decision(a),
            _payment_decision(a),
            _contact_decision(a),
        ],
        "terms": TERMS,
    }


# ---------------------------------------------------------------------------
# Validation and storage
# ---------------------------------------------------------------------------

REQUIRED_FIELDS = [
    "full_name", "phone", "service_type", "device_type",
    "device_count", "payment_method", "monthly_amount",
    "contact_pref", "typed_signature",
]


def validate(form):
    errors = []
    a = {k: form.get(k, "").strip() for k in [
        "full_name", "phone", "email", "service_type", "account_name",
        "account_number", "device_type", "device_count", "has_downloader",
        "payment_method", "monthly_amount", "contact_pref",
        "typed_signature", "signature_image",
    ]}
    for field in REQUIRED_FIELDS:
        if not a[field]:
            errors.append(field)
    if a["service_type"] not in SERVICE_TYPES:
        errors.append("service_type")
    if a["device_type"] not in DEVICE_TYPES:
        errors.append("device_type")
    if a["payment_method"] not in PAYMENT_OPTIONS:
        errors.append("payment_method")
    if a["service_type"] == "reactivation" and not a["account_name"]:
        errors.append("account_name")
    if not re.match(r"^\d+(\.\d{1,2})?$", a["monthly_amount"]):
        errors.append("monthly_amount")
    if form.get("esign_consent") != "on":
        errors.append("esign_consent")
    # Only accept an embedded PNG/JPEG data URL for the drawn signature.
    if a["signature_image"] and not a["signature_image"].startswith("data:image/"):
        a["signature_image"] = ""
    return a, sorted(set(errors))


def save_intake(record):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, "%s.json" % record["id"])
    with open(path, "w") as f:
        json.dump(record, f, indent=2)


def load_intake(intake_id):
    if not re.match(r"^[0-9a-f-]{36}$", intake_id):
        return None
    path = os.path.join(DATA_DIR, "%s.json" % intake_id)
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@intake_bp.route("/intake", methods=["GET"])
def intake_form():
    return render_template(
        "intake_form.html",
        business=BUSINESS_NAME,
        service_types=SERVICE_TYPES,
        device_types=DEVICE_TYPES,
        payment_options=PAYMENT_OPTIONS,
        errors=[],
        form={},
    )


@intake_bp.route("/intake", methods=["POST"])
def intake_submit():
    answers, errors = validate(request.form)
    if errors:
        return render_template(
            "intake_form.html",
            business=BUSINESS_NAME,
            service_types=SERVICE_TYPES,
            device_types=DEVICE_TYPES,
            payment_options=PAYMENT_OPTIONS,
            errors=errors,
            form=request.form,
        ), 400

    now = datetime.now(timezone.utc)
    record = {
        "id": str(uuid.uuid4()),
        "created_at": now.isoformat(),
        "answers": answers,
        "packet": build_packet(answers),
        "client_signature": {
            "typed_name": answers["typed_signature"],
            "image": answers["signature_image"],
            "signed_at": now.isoformat(),
            "consent": True,
        },
        # The business pre-authorizes acceptance of any packet where every
        # decision resolved, so the countersignature is stamped automatically.
        "provider_signature": {
            "accepted_by": BUSINESS_NAME,
            "accepted_at": now.isoformat(),
        },
    }
    save_intake(record)
    return redirect(url_for("intake.intake_packet", intake_id=record["id"]))


@intake_bp.route("/intake/<intake_id>", methods=["GET"])
def intake_packet(intake_id):
    record = load_intake(intake_id)
    if record is None:
        abort(404)
    return render_template(
        "intake_packet.html",
        business=BUSINESS_NAME,
        record=record,
        service_types=SERVICE_TYPES,
        device_types=DEVICE_TYPES,
    )
