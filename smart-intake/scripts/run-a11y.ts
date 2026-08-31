import { runA11yChecks } from "./test-a11y";
runA11yChecks().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
