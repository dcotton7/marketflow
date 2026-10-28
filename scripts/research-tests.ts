/** Runs the strategy research unit tests:  npx tsx scripts/research-tests.ts */
const files = ["cycle", "setups", "trade", "lookahead", "portfolio"];
for (const f of files) await import(`../server/research/${f}.test.ts`);
console.log(`research tests: ${files.length} files ok`);
