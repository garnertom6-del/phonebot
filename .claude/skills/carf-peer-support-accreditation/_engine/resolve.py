"""Provider record -> tokens, with a capability gate and a blanks ledger.

Two rules this file exists to enforce:
  1. NEVER invent a name, date, credential, or number. A missing field becomes a
     fill-in line in the document and a row in BLANKS_TO_COMPLETE.md.
  2. NEVER build a packet whose content contradicts the provider's real profile.
     The manual makes flat factual claims about the agency. See SKILL.md.
"""
import json
import os
from datetime import date

ENGINE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(ENGINE)
CONTENT = os.path.join(ENGINE, "content")

BLANK = "____________________________"

# What the bundled content actually supports. Extend ONLY after writing the
# missing policy content -- never by editing a provider record to pass.
SUPPORTED = {
    "programs": {"community_integration"},
    "population": {"adults", "older_adults"},
    "settings": {"office", "community", "home", "telehealth"},
    "administers_medication": {False},
    "uses_restrictive_interventions": {False},
}

DEFAULT_TIMEFRAMES = {
    "ACCESS_DAYS": "3",       # referral -> first contact, business days
    "PLAN_DAYS": "30",        # admission -> signed person-centered plan
    "REVIEW_DAYS": "90",      # plan review interval
    "NOTE_HOURS": "24",       # service -> completed note
    "DISCHARGE_DAYS": "10",   # last contact -> discharge summary
    "FOLLOWUP_DAYS": "30",    # discharge -> follow-up contact attempt
    "RETENTION_YEARS": "7",   # record retention
}

# Every timeframe above is an ORGANIZATIONAL choice, not a CARF number. They must
# be checked against state rule and payer contract, which may be stricter.
TIMEFRAME_NOTE = ("organizational timeframe -- confirm against your state licensure rule "
                  "and every payer contract; the strictest one wins")

PROGRAM_NAMES = {
    "community_integration": "Community Integration",
    "case_management": "Case Management/Services Coordination",
    "outpatient_treatment": "Outpatient Treatment",
    "assertive_community_treatment": "Assertive Community Treatment",
    "crisis_intervention": "Crisis Intervention",
    "supported_living": "Supported Living",
    "health_home": "Health Home",
    "ccbhc": "Certified Community Behavioral Health Clinic",
}

SETTING_NAMES = {
    "office": "the agency office",
    "community": "community locations",
    "home": "the homes of persons served",
    "telehealth": "by telehealth",
    "residential": "residential settings",
}


class GateError(Exception):
    pass


class Resolver:
    def __init__(self, provider):
        self.p = provider
        self.blanks = []       # (token, human label, where it matters)
        self.decisions = []    # (token, value, why the user must confirm it)

    # ---------- helpers ----------
    def need(self, key, label, matters):
        """Return the value, or a LABELLED placeholder, recording the gap.

        A labelled placeholder beats a bare underscore line: it still refuses to
        invent a name, but it tells the reader which role is unfilled and it is
        greppable, so nothing ships with an unexplained blank.
        """
        v = self.p.get(key)
        if v in (None, "", []):
            self.blanks.append((key, label, matters))
            return f"[FILL IN: {label}]"
        return v

    def opt(self, key, default):
        v = self.p.get(key)
        return default if v in (None, "", []) else v

    # ---------- gate ----------
    def gate(self):
        errs = []
        for prog in self.p.get("programs", []):
            if prog not in SUPPORTED["programs"]:
                errs.append(
                    f"program '{prog}': this engine carries Section 3 content for "
                    f"{sorted(SUPPORTED['programs'])} only. Write the Section 3 policy "
                    f"content for '{prog}' first, then add it to SUPPORTED.")
        if not self.p.get("programs"):
            errs.append("no program listed. CARF accredits programs, not job titles -- "
                        "see SKILL.md 'THE PEER SUPPORT NAMING TRAP'.")
        pop = self.p.get("population")
        if pop not in SUPPORTED["population"]:
            errs.append(
                f"population '{pop}': the bundled content is written for adults. Serving "
                f"adolescents requires added content on guardianship, education, family "
                f"involvement, and child protective reporting that is not in this engine.")
        for s in self.p.get("settings", []):
            if s not in SUPPORTED["settings"]:
                errs.append(
                    f"setting '{s}': 24-hour/residential standards are not carried by this "
                    f"engine.")
        for flag in ("administers_medication", "uses_restrictive_interventions"):
            if self.p.get(flag, False) not in SUPPORTED[flag]:
                errs.append(
                    f"{flag} is true: the bundled manual states in print that the agency does "
                    f"NOT do this. Building anyway would file a document that says something "
                    f"untrue about the agency. Write the missing policy content first.")
        if errs:
            raise GateError("\n".join(f"  - {e}" for e in errs))

    # ---------- tokens ----------
    def tokens(self):
        p = self.p
        t = {}
        t["AGENCY"] = p["legal_name"] + (f" (d/b/a {p['dba']})" if p.get("dba") else "")
        t["AGENCY_SHORT"] = p.get("dba") or p["legal_name"]
        addr = ", ".join(x for x in [p.get("address"), p.get("city"), p.get("state"), p.get("zip")] if x)
        t["FULL_ADDRESS"] = addr or "[FILL IN: Physical address]"
        if not addr:
            self.blanks.append(("address", "Physical address", "Health and Safety Plan, program description"))
        t["PHONE"] = self.need("phone", "Main phone number", "Rights handout, grievance procedure")
        counties = p.get("counties_served") or []
        t["COUNTIES"] = ", ".join(counties) if counties else "[FILL IN: Counties served]"
        if not counties:
            self.blanks.append(("counties_served", "Counties served",
                                "Program description, resource directory, accessibility plan"))

        t["CEO_TITLE"] = self.opt("ceo_title", "Chief Executive Officer")
        for key, label, matters in [
            ("ceo", "Chief Executive Officer name", "signature blocks throughout"),
            ("program_director", "Program Director name", "policy owners, survey interviews"),
            ("clinical_supervisor", "Supervisor of the peer workforce", "supervision and competency policies"),
            ("qi_coordinator", "Quality Improvement Coordinator", "all Section 1.M and 1.N documents"),
            ("safety_officer", "Safety Officer", "Health and Safety Plan, drills, incidents"),
            ("privacy_officer", "Privacy Officer", "confidentiality, breach response, records"),
            ("compliance_officer", "Compliance Officer", "Corporate Compliance Plan"),
        ]:
            t[key.upper()] = self.need(key, label, matters)
        t["GOVERNING_BODY"] = self.opt("governing_body", "the governing body")

        progs = [PROGRAM_NAMES.get(x, x) for x in p.get("programs", [])]
        t["PROGRAM_NAME"] = " and ".join(progs) if progs else "[FILL IN: CARF program]"
        t["SETTINGS"] = ", ".join(SETTING_NAMES.get(s, s) for s in p.get("settings", [])) or "[FILL IN: service settings]"
        t["PEER_CREDENTIAL"] = self.need("state_peer_credential", "State peer support credential",
                                         "hiring, verification, job descriptions, scope")
        t["EHR"] = self.opt("ehr", "the electronic health record")
        t["SURVEY_TARGET"] = self.opt("target_survey_month", "[FILL IN: target survey month]")
        t["CONSULTANT"] = self.opt("consultant", "")

        tf = p.get("timeframes") or {}
        for k, v in DEFAULT_TIMEFRAMES.items():
            if k in tf:
                t[k] = str(tf[k])
            else:
                t[k] = v
                self.decisions.append((k, v, TIMEFRAME_NOTE))

        # ----- conditional content -----
        if p.get("handles_sud_records"):
            t["PART2_CLAUSE"] = ", and 42 CFR Part 2 for substance use disorder records"
            t["PART2_SHORT"] = " and 42 CFR Part 2"
            t["PART2_PARAGRAPH"] = (
                "Records identifying a person as having a substance use disorder are additionally "
                "protected by 42 CFR Part 2. Such information is not disclosed -- including to law "
                "enforcement, family, or a court -- without a Part 2-compliant written consent, a "
                "court order meeting Part 2 requirements, or a recognized exception such as a "
                "medical emergency or a report of suspected child abuse. Every Part 2 disclosure "
                "carries the required notice prohibiting re-disclosure.")
            t["PART2_ROI_CLAUSE"] = (
                "- Because this information is protected by 42 CFR Part 2, the person receiving it "
                "may not pass it on without my written permission, except as the law allows.")
        else:
            t["PART2_CLAUSE"] = ""
            t["PART2_SHORT"] = ""
            t["PART2_PARAGRAPH"] = (
                "{{AGENCY}} does not hold records identifying a person as having a substance use "
                "disorder within the meaning of 42 CFR Part 2. If that changes, Part 2 procedures "
                "are adopted before the first such record is created.")
            t["PART2_ROI_CLAUSE"] = ""

        t["RESTRAINT_STATEMENT"] = (
            "{{AGENCY}} prohibits restraint, seclusion, and every form of isolation, coercion, and "
            "physical intervention used to control a person's movement, in all of its programs, "
            "without exception.")

        t["MEDICATION_STATEMENT"] = (
            "{{AGENCY}} does not prescribe, dispense, administer, pre-pour, store, transport, or "
            "dispose of medication, and its personnel do not advise any person to start, stop, "
            "change, or skip a medication. Peer support personnel support a person's own "
            "self-management and their own conversation with their prescriber, and nothing more.")

        if p.get("uses_telehealth"):
            t["TELEHEALTH_NOTE"] = ""
        else:
            t["TELEHEALTH_NOTE"] = ("**Note:** {{AGENCY}} does not currently deliver service using "
                                    "information and communication technology. This policy is "
                                    "adopted in advance and applies from the first such contact.")

        if p.get("provides_transportation"):
            t["TRANSPORT_STATEMENT"] = ("{{AGENCY}} transports persons served only under the "
                                        "conditions set out in this policy.")
            t["TRANSPORT_NOTE"] = ""
        else:
            t["TRANSPORT_STATEMENT"] = ("{{AGENCY}} does not transport persons served. Staff support "
                                        "people to use their own and their community's "
                                        "transportation, and this policy applies from the day that "
                                        "changes.")
            t["TRANSPORT_NOTE"] = ("**Note:** {{AGENCY}} does not currently transport persons "
                                   "served. The driver and vehicle requirements below apply from "
                                   "the first day it does.")

        t["TODAY"] = date.today().isoformat()
        t["EFFECTIVE_DATE"] = self.opt("effective_date", "[FILL IN: effective date]")
        t["MANUAL_YEAR"] = p.get("manual_year", "[FILL IN: manual year]")
        return t


def substitute(text, tokens, passes=3):
    """Replace {{TOKEN}}; conditional values may themselves contain tokens."""
    for _ in range(passes):
        before = text
        for k, v in tokens.items():
            text = text.replace("{{" + k + "}}", str(v))
        if text == before:
            break
    return text


def load_provider(slug):
    path = os.path.join(SKILL, "providers", slug, "provider.json")
    if not os.path.exists(path):
        alt = os.path.join(SKILL, "providers", f"{slug}.json")
        if os.path.exists(alt):
            path = alt
        else:
            raise FileNotFoundError(
                f"No provider record at {path}. Create it from _engine/provider.schema.json.")
    with open(path) as f:
        return json.load(f)


def read_content(kind, name):
    with open(os.path.join(CONTENT, kind, f"{name}.md")) as f:
        return f.read()


def parse_front_matter(md):
    """Return (meta dict, body). Front matter is a --- fenced key: value block."""
    if not md.startswith("---"):
        return {}, md
    end = md.find("\n---", 3)
    if end == -1:
        return {}, md
    block, body = md[3:end], md[end + 4:]
    meta = {}
    for line in block.strip().split("\n"):
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, body.lstrip("\n")


def list_content(kind):
    d = os.path.join(CONTENT, kind)
    return sorted(f[:-3] for f in os.listdir(d) if f.endswith(".md"))
