import path from 'node:path';
import { auditLinuxBundle } from './linux-packaging.mjs';
const directory = path.resolve(process.argv[2] || '.build/linux-x64/BananaStudio');
const report = auditLinuxBundle(directory);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
