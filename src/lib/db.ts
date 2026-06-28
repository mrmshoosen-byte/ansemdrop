import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { SCHEMA_SQL } from "@/lib/schema";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getConnectionString() {
  return (
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    process.env.POSTGRES_URL_NON_POOLING
  );
}

export function getPool() {
  if (!pool) {
    const connectionString = getConnectionString();
    if (!connectionString) {
      throw new Error("DATABASE_URL or POSTGRES_URL is required");
    }

    pool = new Pool({
      connectionString,
      max: 5,
      ssl: connectionString.includes("localhost")
        ? false
        : { rejectUnauthorized: false }
    });
  }

  return pool;
}

export async function ensureDatabase() {
  if (!schemaReady) {
    schemaReady = getPool().query(SCHEMA_SQL).then(() => undefined);
  }

  return schemaReady;
}

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = []
) {
  await ensureDatabase();
  return getPool().query<T>(text, params);
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>) {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
