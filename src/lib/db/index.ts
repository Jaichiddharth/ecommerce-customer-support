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

    client = postgres(connectionString);
    database = drizzle(client, { schema });

    return database;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
    get(_target, property, receiver) {
        const database = getDb();

        const value = Reflect.get(database, property, receiver);

        return typeof value === "function" ? value.bind(database) : value;
    },
});

export * from "./schema";