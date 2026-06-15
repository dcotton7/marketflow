/**
 * Copy TOS files from their attached locations to real filesystem paths.
 * Run after placing TOS CSV files in the workspace via IDE drag/drop.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const targetDir = join(__dirname, "../../data/tos-imports");
if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

const files = readdirSync(targetDir).filter((f) => f.endsWith(".csv"));
console.log(`Found ${files.length} CSV files in ${targetDir}:`);
for (const f of files) {
  const size = readFileSync(join(targetDir, f)).length;
  console.log(`  ${f} (${size} bytes)`);
}
