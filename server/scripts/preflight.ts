const path = require("path");
const dotenv = require("dotenv");
const { getEnvironmentReport } = require("../utils/envGuard");

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const report = getEnvironmentReport();
if (report.ok) {
  process.stdout.write("Production preflight passed.\n");
} else {
  process.stderr.write("Production preflight failed:\n");
  for (const issue of report.issues) {
    process.stderr.write(`- ${issue}\n`);
  }
}

if (report.warnings.length > 0) {
  process.stdout.write("Warnings:\n");
  for (const warning of report.warnings) {
    process.stdout.write(`- ${warning}\n`);
  }
}

process.exit(report.ok ? 0 : 1);
