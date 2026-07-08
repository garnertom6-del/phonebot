// Copies the pdfjs worker into public/ so the PDF mapping screen can load it
// without webpack bundling it (runs on postinstall).
import fs from "fs";
fs.mkdirSync("public", { recursive: true });
fs.copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/pdf.worker.min.mjs");
console.log("pdf.worker.min.mjs -> public/");
