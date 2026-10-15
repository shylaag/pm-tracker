import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { pool } from "./pool";

/**
 * Applies every .sql file in src/sql in filename order. Each file is written to
 * be idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING), so this is safe to
 * re-run. Run with: npm run migrate
 */
async function main() {
  const dir = join(__dirname, "..", "sql");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8");
    process.stdout.write(`applying ${f} … `);
    await pool.query(sql);
    console.log("ok");
  }
  await pool.end();
  console.log("migrations complete");
}

main().catch((e) => {
  console.error("\nmigration failed:", e);
  process.exit(1);
});
