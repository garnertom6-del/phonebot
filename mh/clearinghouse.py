"""Clearinghouse adapters for Medicaid eligibility checks (270/271).

Two backends:

- MockClearinghouse: no account needed. Deterministic fake results so the
  whole workflow can be tested end to end before signing up with a
  clearinghouse. Selected when CLEARINGHOUSE=mock or no account key is set.

- ClaimMDClearinghouse: real checks through Claim.MD's eligibility API.
  Requires CLAIMMD_ACCOUNT_KEY and PROVIDER_NPI. Field names follow
  Claim.MD's eligibility service; verify payer id and field spelling
  against your Claim.MD account's payer list before go-live.

Both return an EligibilityResult, which routes.py stores as an
EligibilityCheck row.
"""
import json
import os
from dataclasses import dataclass, field
from datetime import date


# How NC Medicaid coverage is delivered, keyed by phrases that appear in
# plan/payer names on eligibility responses. Standard Plans and Tailored
# Plans are billed through the health plan, not NCTracks fee-for-service,
# so knowing which one the client is under matters for billing and auths.
NC_PLAN_KEYWORDS = {
    "HEALTHY BLUE": ("Healthy Blue", "Standard Plan"),
    "WELLCARE": ("WellCare of NC", "Standard Plan"),
    "UNITEDHEALTHCARE": ("UnitedHealthcare Community Plan", "Standard Plan"),
    "UNITED HEALTHCARE": ("UnitedHealthcare Community Plan", "Standard Plan"),
    "AMERIHEALTH": ("AmeriHealth Caritas NC", "Standard Plan"),
    "CAROLINA COMPLETE": ("Carolina Complete Health", "Standard Plan"),
    "ALLIANCE": ("Alliance Health", "Tailored Plan"),
    "TRILLIUM": ("Trillium Health Resources", "Tailored Plan"),
    "VAYA": ("Vaya Health", "Tailored Plan"),
    "PARTNERS": ("Partners Health Management", "Tailored Plan"),
    "MEDICAID DIRECT": ("NC Medicaid Direct", "NC Medicaid Direct"),
}


def classify_nc_plan(text):
    """Return (plan_name, plan_type) guessed from response text."""
    if not text:
        return (None, "Unknown")
    upper = text.upper()
    for keyword, (plan, plan_type) in NC_PLAN_KEYWORDS.items():
        if keyword in upper:
            return (plan, plan_type)
    return (None, "Unknown")


@dataclass
class EligibilityResult:
    status: str  # active | inactive | review | error
    payer_name: str = None
    plan_name: str = None
    plan_type: str = "Unknown"
    coverage_start: str = None
    coverage_end: str = None
    message: str = None
    raw_response: str = None
    source: str = "mock"


class MockClearinghouse:
    """Fake results for development and demos.

    Rule: a medicaid_id ending in 0 comes back inactive, ending in 9 comes
    back as needs-review, anything else is active. The plan is picked from
    the client's id so results are stable between runs.
    """

    source = "mock"

    PLANS = [
        ("Trillium Health Resources", "Tailored Plan"),
        ("Healthy Blue", "Standard Plan"),
        ("Alliance Health", "Tailored Plan"),
        ("WellCare of NC", "Standard Plan"),
        ("NC Medicaid Direct", "NC Medicaid Direct"),
    ]

    def check(self, first_name, last_name, dob, medicaid_id):
        raw = json.dumps(
            {
                "mock": True,
                "member": f"{first_name} {last_name}",
                "medicaid_id": medicaid_id,
            }
        )
        if medicaid_id.strip().endswith("0"):
            return EligibilityResult(
                status="inactive",
                payer_name="NC Medicaid",
                message="MOCK: no active coverage found for this ID.",
                raw_response=raw,
                source=self.source,
            )
        if medicaid_id.strip().endswith("9"):
            return EligibilityResult(
                status="review",
                payer_name="NC Medicaid",
                message="MOCK: payer response unclear - staff review needed.",
                raw_response=raw,
                source=self.source,
            )
        plan, plan_type = self.PLANS[sum(ord(c) for c in medicaid_id) % len(self.PLANS)]
        return EligibilityResult(
            status="active",
            payer_name="NC Medicaid",
            plan_name=plan,
            plan_type=plan_type,
            coverage_start=date.today().replace(month=1, day=1).isoformat(),
            message=f"MOCK: active coverage under {plan}.",
            raw_response=raw,
            source=self.source,
        )


class ClaimMDClearinghouse:
    """Real 270/271 checks via Claim.MD.

    Setup:
      1. Open a Claim.MD account and enroll for NC Medicaid eligibility.
      2. Set CLAIMMD_ACCOUNT_KEY and PROVIDER_NPI env vars.
      3. Confirm the NC Medicaid payer id in your Claim.MD payer list and
         set NC_MEDICAID_PAYER_ID if it differs from the default below.
    """

    source = "claimmd"
    URL = "https://svc.claim.md/services/eligdata/"

    def __init__(self, account_key, npi, payer_id):
        self.account_key = account_key
        self.npi = npi
        self.payer_id = payer_id

    def check(self, first_name, last_name, dob, medicaid_id):
        import requests  # imported here so mock mode needs no network stack

        payload = {
            "AccountKey": self.account_key,
            "prov_npi": self.npi,
            "payerid": self.payer_id,
            "ins_name_f": first_name,
            "ins_name_l": last_name,
            "ins_dob": dob.strftime("%Y%m%d"),
            "ins_number": medicaid_id,
            "fdos": date.today().strftime("%Y%m%d"),
        }
        try:
            resp = requests.post(
                self.URL,
                data=payload,
                headers={"Accept": "application/json"},
                timeout=30,
            )
            resp.raise_for_status()
            raw = resp.text
        except Exception as exc:  # network / auth problems
            return EligibilityResult(
                status="error",
                message=f"Clearinghouse request failed: {exc}",
                source=self.source,
            )
        return self._parse(raw)

    def _parse(self, raw):
        """Classify a 271 response conservatively.

        EB01 code "1" means Active Coverage, "6"/"7"/"8" mean inactive.
        Anything we cannot classify is returned as "review" (never guessed
        active) with the raw response attached for a human to read.
        """
        try:
            data = json.loads(raw)
        except ValueError:
            return EligibilityResult(
                status="review",
                message="Could not parse payer response - review raw text.",
                raw_response=raw,
                source=self.source,
            )

        flat = json.dumps(data).upper()
        plan_name, plan_type = classify_nc_plan(flat)

        status = "review"
        message = "Response received - could not auto-classify; review needed."
        benefits = self._find_benefits(data)
        codes = {str(b.get("benefit_code", b.get("eb01", ""))) for b in benefits}
        descriptions = " ".join(
            str(b.get("benefit_description", b.get("description", ""))) for b in benefits
        ).upper()

        if "1" in codes or "ACTIVE COVERAGE" in descriptions or "ACTIVE COVERAGE" in flat:
            status = "active"
            message = "Active coverage reported by payer."
        elif codes & {"6", "7", "8"} or "INACTIVE" in flat:
            status = "inactive"
            message = "Payer reports coverage is not active."

        return EligibilityResult(
            status=status,
            payer_name="NC Medicaid",
            plan_name=plan_name,
            plan_type=plan_type,
            message=message,
            raw_response=raw,
            source=self.source,
        )

    @staticmethod
    def _find_benefits(data):
        """Collect benefit-looking dicts from the response, wherever nested."""
        found = []

        def walk(node):
            if isinstance(node, dict):
                if "benefit_code" in node or "eb01" in node:
                    found.append(node)
                for value in node.values():
                    walk(value)
            elif isinstance(node, list):
                for item in node:
                    walk(item)

        walk(data)
        return found


def get_clearinghouse():
    """Pick the backend from environment configuration."""
    choice = os.environ.get("CLEARINGHOUSE", "").lower()
    account_key = os.environ.get("CLAIMMD_ACCOUNT_KEY")

    if choice == "mock" or (not choice and not account_key):
        return MockClearinghouse()

    if choice in ("", "claimmd"):
        if not account_key:
            raise RuntimeError(
                "CLEARINGHOUSE=claimmd but CLAIMMD_ACCOUNT_KEY is not set."
            )
        npi = os.environ.get("PROVIDER_NPI")
        if not npi:
            raise RuntimeError("PROVIDER_NPI env var is required for real checks.")
        payer_id = os.environ.get("NC_MEDICAID_PAYER_ID", "NCMCD")
        return ClaimMDClearinghouse(account_key, npi, payer_id)

    raise RuntimeError(f"Unknown CLEARINGHOUSE value: {choice}")
