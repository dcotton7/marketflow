import { initializeDatabase } from "../db";
import { ensurePositionSchema } from "../alerts/ensure-schema";

async function main() {
  await initializeDatabase();
  if (!(await ensurePositionSchema())) throw new Error("Database not available");
  console.log("position columns ready");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
