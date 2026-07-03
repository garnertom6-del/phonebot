# mdc_intake.py - Moore Divine Care, Inc. automated Client Intake Packet.
#
# Send the client one link (/mdc). They answer guided questions by voice or
# typing, sign once on screen, and the full intake packet is generated with
# every client field, signature line, initial box and date filled in.
# Staff-only lines (QP / clinician / witness) are left blank for the office.
#
# Two delivery modes:
#   1. Built-in e-signature: client draws or types their signature in the
#      wizard; it is stamped on every signature line with an audit trail.
#   2. DocuSign: POST /mdc/docusign/<id> sends the completed packet through
#      DocuSign for a certified signature ceremony (uses anchor tabs, so the
#      client just taps each highlighted spot). Needs DOCUSIGN_* env vars.
import base64
import json
import os
import re
import uuid
from datetime import datetime, timezone

import requests as http
from flask import Blueprint, abort, jsonify, render_template, request

mdc_bp = Blueprint("mdc", __name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "mdc_intakes")

AGENCY = {
    "name": "Moore Divine Care, Inc.",
    "address": "1 Centerview Drive, Suite 102, Greensboro, NC 27407",
    "phone": "336-285-5204",
    "crisis": "336-285-5204",
    "office_hours": "Greensboro Office 10am-4pm",
    "team": [
        "Karen Jones, Nurse Practitioner",
        "Tonya Jones, Clinical Director",
        "Thadeous Young, Qualified Professional",
    ],
}

# Every consent / acknowledgment in the packet that the client (or guardian)
# signs. The wizard shows each one; the single captured signature + initials
# are applied to each agreed item in the generated packet.
CONSENTS = [
    ("provider_choice", "Provider Choice",
     "I understand I have the right to choose my provider. I select Moore Divine Care, Inc. "
     "as my provider of choice and have been offered a list of other providers offering the "
     "same or similar services. I may change my service provider at any time with reasonable notice."),
    ("orientation", "Client Orientation",
     "Upon admission I have been instructed in or given written materials regarding my rights and "
     "responsibilities, grievance and appeal procedures, services and activities, hours of operation, "
     "after-hours access, code of ethics, confidentiality policy, fees and financial arrangements, "
     "the premises (emergency exits, fire suppression, first aid), program policies (seclusion/restraint, "
     "smoking, drugs, weapons, abuse and neglect), my service coordinator, program rules, advance "
     "directives, the assessment process, my individual plan, and transition criteria."),
    ("rights", "Client Rights and Responsibilities Acknowledgment",
     "I have read and understand my rights and responsibilities as a participant in services at "
     "Moore Divine Care, Inc., including the right to be treated with respect, to be fully informed "
     "about my care, to revoke consent at any time, to receive services free of all forms of abuse, "
     "to confidentiality protections, and to file grievances without fear of retaliation; and my "
     "responsibility to treat others respectfully, participate actively in treatment, and attend "
     "services alcohol and drug free."),
    ("treatment", "Consent for Treatment",
     "I understand: (a) my protections regarding confidential information; (b) how to receive a copy "
     "of my service plan; (c) fees charged and collection of fees; (d) the grievance procedure; "
     "(e) suspension and expulsion from services; (f) search and seizure of personal possessions. "
     "I can contact the Governor's Advocacy Council for Persons with Disabilities (GACPD), 2626 "
     "Glenwood Avenue Suite 550, Raleigh NC 27608, Voice (919) 856-2195, Toll Free (877) 235-4210, "
     "TTY 888-268-5535, info@disabilityrightsnc.org. I understand the benefits, potential risks and "
     "possible alternative methods of treatment. I have the right to refuse treatment at any time but "
     "choose to consent to treatment at this time. I have received a copy of “Your Rights as a "
     "Client” and of the consumer handbook."),
    ("oncall", "Acknowledgement of 24 Hour On-Call Service",
     "I have been informed that Moore Divine Care, Inc. provides 24 hours, 7 days a week emergency "
     "telephone service. The Crisis Number is 336-285-5204."),
    ("bill_of_rights", "Bill of Rights",
     "I have reviewed the Client Acknowledgement of 24 Hour On-Call Service, was given the opportunity "
     "to ask questions, was provided the names of staff who will be working with me, and was provided "
     "a 24/7/365 Crisis Telephone number. The Bill of Rights has been explained to me in terms I understand."),
    ("transport", "Consent to Transport",
     "I authorize Moore Divine Care, Inc. to provide transportation for the purpose of providing "
     "comprehensive Mental Health / Developmental / Substance Abuse services and other activities "
     "associated with my treatment plan. I understand Moore Divine Care, Inc. is not responsible for "
     "accidents that may occur while transportation is being provided."),
    ("emergency_care", "Consent to Emergency Care",
     "I authorize Moore Divine Care, Inc. to obtain emergency medical care for me or my child if the "
     "need arises. I have provided the medical facility of my preference; if this is not possible the "
     "nearest emergency facility will become my preference. Every attempt will be made to contact my "
     "emergency contacts."),
    ("emergency_interventions", "Consent for Emergency Interventions",
     "I have been informed that Moore Divine Care, Inc. will use verbal prompts and NCI emergency "
     "interventions when non-physical interventions have proven ineffective or behavior poses a threat "
     "of imminent, serious physical harm to self and/or others (therapeutic holds, physical escort, "
     "emergency intervention, emergency restraint). I have been informed of the alleged benefits, "
     "potential risks and possible alternatives, and give my consent. This consent is valid for up to "
     "one year and may be withdrawn at any time."),
    ("hipaa", "Notice of Privacy Practices (HIPAA)",
     "I have reviewed the notice describing how medical information about me may be used and disclosed "
     "and how I can get access to this information. I understand the information that was explained to "
     "me, was given the opportunity to ask questions, and was given a copy of this information."),
    ("confidentiality", "Confidentiality Exception Form",
     "I understand Moore Divine Care, Inc. has strict Confidentiality and Client Rights policies. The "
     "exceptions to the Confidentiality Rule under N.C.G.S. §§ 122C-53 through 122C-56 have "
     "been explained to me and I agree with them. If I feel my confidentiality rights have been "
     "violated I may contact the Client Rights Committee Chair Person at (336) 285-5204."),
    ("treatment_plan", "Treatment Plan Participation & Receipt",
     "I have met (or will meet) with agency staff to review and discuss the goals and outcomes of my "
     "treatment plan. The goals and clinical direction meet my expectations, I agree with the direction "
     "of services, and I will receive a copy of the current treatment plan."),
    ("insurance_switch", "Tailored Plan Insurance Permission",
     "If a service ordered by the physician is not covered in my insurance plan, I give Moore Divine "
     "Care, Inc. permission to switch my insurance to the Tailored Plan that best suits my service needs."),
]

ROI_ITEMS = [
    "Admission/Screening Assessment", "HIV related information", "Service Notes", "VO",
    "Medication history/physician orders", "Psychological testing", "Service Plan", "LME",
    "Discharge Information", "Substance Abuse Information", "Psychiatric Evaluation",
    "Reciprocal exchange permitted", "Accounting of Disclosure Report", "NCTOPPS",
]


def _ensure_dir():
    os.makedirs(DATA_DIR, exist_ok=True)


def _path(intake_id):
    if not re.fullmatch(r"[a-f0-9]{32}", intake_id):
        abort(404)
    return os.path.join(DATA_DIR, intake_id + ".json")


def _load(intake_id):
    try:
        with open(_path(intake_id)) as f:
            return json.load(f)
    except FileNotFoundError:
        abort(404)


def _admin_ok():
    key = os.environ.get("INTAKE_ADMIN_KEY")
    return key and request.args.get("key") == key


def _initials(name):
    parts = [p for p in re.split(r"[\s\-]+", (name or "").strip()) if p]
    return "".join(p[0].upper() for p in parts)[:4]


# ---------------------------------------------------------------------------
# Client-facing routes
# ---------------------------------------------------------------------------

@mdc_bp.route("/mdc")
def wizard():
    return render_template("mdc_wizard.html", consents=CONSENTS, roi_items=ROI_ITEMS, agency=AGENCY)


@mdc_bp.route("/mdc/submit", methods=["POST"])
def submit():
    payload = request.get_json(silent=True)
    if not payload or not isinstance(payload.get("answers"), dict):
        return jsonify({"error": "Missing answers"}), 400
    a = payload["answers"]
    if not (a.get("client_name") or "").strip():
        return jsonify({"error": "Client name is required"}), 400
    if not payload.get("esign_consent"):
        return jsonify({"error": "Electronic signature consent is required"}), 400

    intake_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    record = {
        "id": intake_id,
        "submitted_at": now.isoformat(),
        "intake_date": now.strftime("%m/%d/%Y"),
        "answers": a,
        "consents": payload.get("consents", {}),
        "signature": {
            "image": payload.get("signature_image") or "",   # data URL from canvas
            "typed": payload.get("signature_typed") or "",
            "signer_name": payload.get("signer_name") or a.get("client_name", ""),
            "signer_role": payload.get("signer_role") or "client",
            "initials": _initials(payload.get("signer_name") or a.get("client_name", "")),
        },
        "audit": {
            "ip": request.headers.get("X-Forwarded-For", request.remote_addr),
            "user_agent": request.headers.get("User-Agent", ""),
            "esign_consent": True,
            "timestamp_utc": now.isoformat(),
        },
    }
    _ensure_dir()
    with open(_path(intake_id), "w") as f:
        json.dump(record, f, indent=2)
    return jsonify({"id": intake_id, "packet_url": "/mdc/packet/" + intake_id})


@mdc_bp.route("/mdc/packet/<intake_id>")
def packet(intake_id):
    record = _load(intake_id)
    return _render_packet(record, docusign_mode=False)


# ---------------------------------------------------------------------------
# Staff routes
# ---------------------------------------------------------------------------

@mdc_bp.route("/mdc/admin")
def admin():
    if not _admin_ok():
        abort(403)
    _ensure_dir()
    rows = []
    for fn in sorted(os.listdir(DATA_DIR), reverse=True):
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(DATA_DIR, fn)) as f:
                r = json.load(f)
            rows.append({
                "id": r["id"],
                "name": r["answers"].get("client_name", "?"),
                "submitted": r.get("submitted_at", ""),
                "docusign": r.get("docusign", {}).get("envelope_id", ""),
            })
        except (json.JSONDecodeError, KeyError):
            continue
    items = "".join(
        '<tr><td>{name}</td><td>{submitted}</td>'
        '<td><a href="/mdc/packet/{id}">packet</a></td><td>{ds}</td></tr>'.format(
            name=r["name"], submitted=r["submitted"][:19].replace("T", " "),
            id=r["id"], ds=(r["docusign"] or "&mdash;"))
        for r in rows)
    return ("<h2>Moore Divine Care &mdash; Completed Intakes</h2>"
            "<table border=1 cellpadding=6><tr><th>Client</th><th>Submitted (UTC)</th>"
            "<th>Packet</th><th>DocuSign envelope</th></tr>" + items + "</table>")


# ---------------------------------------------------------------------------
# Option 2: DocuSign delivery
# ---------------------------------------------------------------------------
# The completed packet is sent to DocuSign as an HTML document. Signature,
# initial and date spots are marked with invisible anchor strings, so DocuSign
# automatically places a tab at EVERY occurrence - the client just taps each
# highlighted spot in the DocuSign ceremony. Requires env vars:
#   DOCUSIGN_BASE_URI    e.g. https://demo.docusign.net/restapi  (or na4.docusign.net)
#   DOCUSIGN_ACCOUNT_ID  the API account id (GUID)
#   DOCUSIGN_ACCESS_TOKEN a valid OAuth access token

SIGN_ANCHOR = "[[MDC_SIGN]]"
INITIAL_ANCHOR = "[[MDC_INIT]]"
DATE_ANCHOR = "[[MDC_DATE]]"


@mdc_bp.route("/mdc/docusign/<intake_id>", methods=["POST"])
def send_docusign(intake_id):
    if not _admin_ok():
        abort(403)
    base = os.environ.get("DOCUSIGN_BASE_URI", "").rstrip("/")
    account = os.environ.get("DOCUSIGN_ACCOUNT_ID", "")
    token = os.environ.get("DOCUSIGN_ACCESS_TOKEN", "")
    if not (base and account and token):
        return jsonify({"error": "DOCUSIGN_BASE_URI, DOCUSIGN_ACCOUNT_ID and "
                                 "DOCUSIGN_ACCESS_TOKEN must be set"}), 400

    record = _load(intake_id)
    email = (record["answers"].get("email") or "").strip()
    name = record["signature"]["signer_name"] or record["answers"].get("client_name", "Client")
    if not email:
        return jsonify({"error": "No client email on this intake"}), 400

    html = _render_packet(record, docusign_mode=True)
    envelope = {
        "emailSubject": "Moore Divine Care, Inc. - Client Intake Packet for signature",
        "emailBlurb": "Please review your completed intake packet and tap each highlighted "
                      "signature spot. It only takes a minute.",
        "status": "sent",
        "documents": [{
            "documentId": "1",
            "name": "Client Intake Packet - %s" % name,
            "fileExtension": "html",
            "documentBase64": base64.b64encode(html.encode("utf-8")).decode("ascii"),
        }],
        "recipients": {"signers": [{
            "email": email,
            "name": name,
            "recipientId": "1",
            "routingOrder": "1",
            "tabs": {
                "signHereTabs": [{"anchorString": SIGN_ANCHOR, "anchorUnits": "pixels",
                                  "anchorXOffset": "0", "anchorYOffset": "-8"}],
                "initialHereTabs": [{"anchorString": INITIAL_ANCHOR, "anchorUnits": "pixels",
                                     "anchorXOffset": "0", "anchorYOffset": "-8"}],
                "dateSignedTabs": [{"anchorString": DATE_ANCHOR, "anchorUnits": "pixels",
                                    "anchorXOffset": "0", "anchorYOffset": "-8"}],
            },
        }]},
    }
    resp = http.post(
        "%s/v2.1/accounts/%s/envelopes" % (base, account),
        json=envelope,
        headers={"Authorization": "Bearer " + token},
        timeout=60,
    )
    if resp.status_code not in (200, 201):
        return jsonify({"error": "DocuSign error", "detail": resp.text[:500]}), 502
    envelope_id = resp.json().get("envelopeId", "")
    record["docusign"] = {"envelope_id": envelope_id,
                          "sent_at": datetime.now(timezone.utc).isoformat()}
    with open(_path(intake_id), "w") as f:
        json.dump(record, f, indent=2)
    return jsonify({"envelope_id": envelope_id, "sent_to": email})


# ---------------------------------------------------------------------------
# Packet rendering
# ---------------------------------------------------------------------------

def _render_packet(record, docusign_mode):
    a = record["answers"]
    sig = record["signature"]
    consents = {k: bool(record.get("consents", {}).get(k)) for k, _, _ in CONSENTS}
    return render_template(
        "mdc_packet.html",
        agency=AGENCY,
        a=a,
        record=record,
        sig=sig,
        consents=consents,
        consent_defs=CONSENTS,
        roi_items=ROI_ITEMS,
        docusign_mode=docusign_mode,
        sign_anchor=SIGN_ANCHOR,
        initial_anchor=INITIAL_ANCHOR,
        date_anchor=DATE_ANCHOR,
    )
