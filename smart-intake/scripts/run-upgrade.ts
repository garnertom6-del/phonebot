import { runUpgradeContractChecks } from "./test-upgrade-contracts";
runUpgradeContractChecks().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
