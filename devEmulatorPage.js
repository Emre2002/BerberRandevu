import { ensureDevEmulatorQueryFlag, applyDevEmulatorLinks } from "./devEmulatorGate.js";

if (!ensureDevEmulatorQueryFlag()) {
    applyDevEmulatorLinks();
}
