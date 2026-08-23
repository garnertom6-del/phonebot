/**
 * Builds an X12 270 eligibility INQUIRY (005010X279A1) to send to NC Tracks
 * over the enrolled Trading Partner / EDI channel.
 *
 * Exact ISA/GS identifiers, the receiver ID, and any qualifiers come from the
 * NC Tracks EDI **companion guide** the provider receives at enrollment - the
 * values here are the standard 270 shape with those specifics pulled from
 * config so we set them without code changes.
 */

export interface Edi270Member {
  lastName: string;
  firstName?: string;
  dob?: string;          // MM/DD/YYYY or YYYY-MM-DD
  gender?: string;       // "Male" | "Female" | ...
  medicaidId?: string;   // if known, the strongest match
}

export interface Edi270Config {
  submitterId: string;   // your NC Tracks 4-digit Trading Partner / submitter ID -> ISA06/GS02
  receiverId: string;    // ISA08/GS03: "NCTRACKSREL" (real-time) or "NCTRACKSBAT" (batch)
  providerNpi: string;   // the provider organization NPI (Type 2) or individual NPI
  providerName: string;  // the provider/organization name
  providerTaxonomy?: string; // 2100B PRV03 taxonomy code - NC Tracks requires this on the inquiry
  providerIdCode?: string;   // 2100B NM101 entity code: "1P" (default), "2B", or "GP"
  payerName?: string;    // 2100A NM103 info-source name, default "NCTRACKS"
  payerId?: string;      // 2100A NM109 info-source id, default "NCTRACKS"
  interchangeSenderQualifier?: string; // ISA05, default "ZZ"
  interchangeReceiverQualifier?: string; // ISA07, default "ZZ"
}

export interface Edi270Context {
  controlNumber: number; // unique per interchange
  traceNumber: string;   // TRN trace, echoed back in the 271
  now: Date;             // stamp (passed in - keeps this pure/testable)
}

const SEG = "~";
const EL = "*";

function ccyymmdd(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}
function yymmdd(d: Date): string {
  return ccyymmdd(d).slice(2);
}
function hhmm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
function pad(v: string, len: number): string {
  return (v + " ".repeat(len)).slice(0, len);
}

/** Normalize a MM/DD/YYYY or YYYY-MM-DD date to CCYYMMDD for X12 D8. */
export function toD8(v: string): string {
  const s = (v || "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}${m[1].padStart(2, "0")}${m[2].padStart(2, "0")}`;
  return s.replace(/\D/g, "");
}

// CAQH CORE / NC Tracks last-name normalization (companion guide section 1.4):
// (1) uppercase, (2) drop titles/suffixes, (3) strip 16 special characters,
// (4) drop suffix tokens (JR, SR, roman numerals, credentials) when set off by
// a space, comma, or slash. NC Tracks matches on the normalized last name.
const NAME_SUFFIXES = [
  "JR", "SR", "III", "II", "IV", "V", "RN", "MD", "MRS", "MR", "MS",
  "DR", "PHD", "REV", "ESQ",
];
export function normalizeLastName(name: string): string {
  let s = (name || "").toUpperCase().trim();
  // rule 4: strip trailing suffix tokens preceded by space/comma/slash
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of NAME_SUFFIXES) {
      const re = new RegExp(`[\\s,/]+${suf}\\.?$`);
      if (re.test(s)) {
        s = s.replace(re, "");
        changed = true;
      }
    }
  }
  // rule 3: remove the 16 special characters  ! ' & ' ( ) * + , - . / : ; ? =
  s = s.replace(/[!'’‘&()*+,\-.\/:;?=]/g, "");
  // tidy whitespace
  return s.replace(/\s+/g, " ").trim();
}

function genderCode(g?: string): string | null {
  const s = (g || "").toLowerCase();
  if (s.startsWith("m")) return "M";
  if (s.startsWith("f")) return "F";
  return null; // U/unknown - omit DMG gender rather than guess
}

export function buildEdi270(member: Edi270Member, cfg: Edi270Config, ctx: Edi270Context): string {
  const ctrl = String(ctx.controlNumber).padStart(9, "0");
  const senderQ = cfg.interchangeSenderQualifier || "ZZ";
  const receiverQ = cfg.interchangeReceiverQualifier || "ZZ";

  const seg: string[] = [];
  // ISA - fixed-width interchange envelope
  seg.push([
    "ISA", "00", pad("", 10), "00", pad("", 10),
    senderQ, pad(cfg.submitterId, 15), receiverQ, pad(cfg.receiverId, 15),
    yymmdd(ctx.now), hhmm(ctx.now), "^", "00501", ctrl, "0", "P", ":",
  ].join(EL));
  // GS - functional group (HS = eligibility inquiry)
  seg.push(["GS", "HS", cfg.submitterId, cfg.receiverId, ccyymmdd(ctx.now), hhmm(ctx.now), String(ctx.controlNumber), "X", "005010X279A1"].join(EL));
  // ST / BHT
  seg.push(["ST", "270", "0001", "005010X279A1"].join(EL));
  seg.push(["BHT", "0022", "13", ctx.traceNumber.slice(0, 30), ccyymmdd(ctx.now), hhmm(ctx.now)].join(EL));
  // 2000A Information Source = NC Tracks (companion guide: NM103/NM109 = NCTRACKS)
  const payerName = cfg.payerName || "NCTRACKS";
  const payerId = cfg.payerId || "NCTRACKS";
  seg.push(["HL", "1", "", "20", "1"].join(EL));
  seg.push(["NM1", "PR", "2", payerName, "", "", "", "", "PI", payerId].join(EL));
  // 2000B Information Receiver = the provider (NM108 XX => NPI in NM109)
  const idCode = cfg.providerIdCode || "1P";
  seg.push(["HL", "2", "1", "21", "1"].join(EL));
  seg.push(["NM1", idCode, "2", cfg.providerName.toUpperCase(), "", "", "", "", "XX", cfg.providerNpi].join(EL));
  // 2100B PRV - NC Tracks requires the provider taxonomy on the inquiry
  if (cfg.providerTaxonomy) {
    seg.push(["PRV", "SB", "PXC", cfg.providerTaxonomy].join(EL));
  }
  // 2000C Subscriber = the client
  seg.push(["HL", "3", "2", "22", "0"].join(EL));
  seg.push(["TRN", "1", ctx.traceNumber.slice(0, 50), cfg.submitterId].join(EL));

  // NM1*IL - by Medicaid ID when known (MI), else by name (identity from DMG/DOB).
  // NC Tracks matches on the *normalized* last name (companion guide section 1.4).
  const normLast = normalizeLastName(member.lastName);
  const firstUp = (member.firstName || "").toUpperCase();
  if (member.medicaidId) {
    seg.push(["NM1", "IL", "1", normLast, firstUp, "", "", "", "MI", member.medicaidId].join(EL));
  } else {
    seg.push(["NM1", "IL", "1", normLast, firstUp].join(EL));
  }
  // DMG - gender + DOB (helps match when no member ID)
  const g = genderCode(member.gender);
  if (member.dob) {
    seg.push(["DMG", "D8", toD8(member.dob), ...(g ? [g] : [])].join(EL));
  }
  // DTP*291 - eligibility "as of" date (today)
  seg.push(["DTP", "291", "D8", ccyymmdd(ctx.now)].join(EL));
  // EQ*30 - Health Benefit Plan Coverage (general eligibility)
  seg.push(["EQ", "30"].join(EL));

  // trailers - SE count includes ST..SE inclusive
  const stIndex = seg.findIndex((s) => s.startsWith("ST" + EL));
  const segsInTx = seg.length - stIndex + 1; // + this SE
  seg.push(["SE", String(segsInTx), "0001"].join(EL));
  seg.push(["GE", "1", String(ctx.controlNumber)].join(EL));
  seg.push(["IEA", "1", ctrl].join(EL));

  return seg.join(SEG) + SEG;
}
