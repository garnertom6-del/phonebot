// Type declarations for the vendored qrcode-generator (MIT, Kazuhiko Arase).
// Only the parts Smart Intake uses are declared.
type QrTypeNumber = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20
  | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40;
type QrErrorCorrectionLevel = "L" | "M" | "Q" | "H";
type QrMode = "Numeric" | "Alphanumeric" | "Byte" | "Kanji";

interface QrCode {
  addData(data: string, mode?: QrMode): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}

interface QrCodeFactory {
  (typeNumber: QrTypeNumber, errorCorrectionLevel: QrErrorCorrectionLevel): QrCode;
}

declare const qrcode: QrCodeFactory;
export = qrcode;
