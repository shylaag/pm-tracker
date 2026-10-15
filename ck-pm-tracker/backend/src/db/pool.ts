import { Pool } from "pg";
import "dotenv/config";

/**
 * One shared pool. Azure Database for PostgreSQL needs SSL — set PGSSL=require.
 * DATABASE_URL is the only required env var.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error", err);
});
