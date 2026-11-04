import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

function getDb() {
    if (database) {
        return database;
    }

    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        throw new Error("DATABASE_URL is not configured");
    }

    client = postgres(connectionString, {
        // Default is 10. Webhook spikes run many short queries at once; size it to the DB's connection budget
        max: envInt("DB_POOL_MAX", 20),
        idle_timeout: envInt("DB_IDLE_TIMEOUT_SECONDS", 20),
        connect_timeout: envInt("DB_CONNECT_TIMEOUT_SECONDS", 10),
        max_lifetime: 60 * 30,
    });
    database = drizzle(client, { schema });

    return database;
}

function envInt(name: string, fallback: number): number {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** The underlying postgres-js client (LISTEN/NOTIFY for the realtime bus). */
export function getPgClient(): ReturnType<typeof postgres> {
    getDb();
    return client!;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
    get(_target, property, receiver) {
        const database = getDb();

        const value = Reflect.get(database, property, receiver);

        return typeof value === "function" ? value.bind(database) : value;
    },
});

export * from "./schema";