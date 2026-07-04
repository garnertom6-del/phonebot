/**
 * Coordinate map for the ACTUAL Moore Divine Care Client Intake Package PDF.
 * Generated from the real document by scripts/generate_map.py (every entry is
 * anchored to label text extracted from the PDF). Staff can adjust individual
 * placements in /admin/pdf-mapping; overrides are stored in the database and
 * merged over this base map at fill time.
 */
import rawMap from "./mooreDivinePacketMap.json";

export type FieldType =
  | "text" | "checkbox" | "signature" | "initials" | "survey_rating" | "signature_small";

export interface FieldMapping {
  page: number;          // 1-based
  fieldKey: string;      // unique key for this placement
  source: string;        // answer key | "key=value" | "key~value" | signature sources
  type: FieldType;
  x: number;             // pdf-lib coords (origin bottom-left)
  y: number;
  width: number;
  height: number;
  fontSize: number;
  lines: number;
  lineHeight: number;
  required: boolean;
  role: "client" | "guardian" | "staff" | "clinician" | "medicalDirector" | "witness" | "auto";
  consentKey: string | null;
  notes: string;
}

export interface PacketMap {
  template: string;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  fields: FieldMapping[];
}

export const PACKET_MAP = rawMap as unknown as PacketMap;
export const TEMPLATE_FILE = "MooreDivineCare_Intake_Packet-1.pdf";
