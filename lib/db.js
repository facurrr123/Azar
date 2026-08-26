// Capa de base de datos (Postgres vía el driver serverless de Neon).
// Lee la cadena de conexión de DATABASE_URL (la que inyecta la integración
// de Neon en Vercel) o, como alternativa, POSTGRES_URL.
const { neon } = require("@neondatabase/serverless");

let _sql = null;

function conn() {
  if (!_sql) {
    const url =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL;
    if (!url) throw new Error("Falta la variable de entorno DATABASE_URL (conexión a Postgres).");
    _sql = neon(url);
  }
  return _sql;
}

// Envoltorio para usar `sql` como plantilla etiquetada y conservar la forma
// { rows } (Neon devuelve el array de filas directamente).
function sql(strings, ...values) {
  return conn()(strings, ...values).then((rows) => ({ rows }));
}

let ready = null;

// Crea las tablas si no existen. Idempotente y cacheado por instancia.
function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id            TEXT PRIMARY KEY,
          name          TEXT NOT NULL,
          email         TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS sorteos (
          id                TEXT PRIMARY KEY,
          code              TEXT UNIQUE NOT NULL,
          user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title             TEXT NOT NULL,
          participants      JSONB NOT NULL,
          winners           JSONB NOT NULL,
          participant_count INTEGER NOT NULL DEFAULT 0,
          animation         TEXT,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`CREATE INDEX IF NOT EXISTS sorteos_user_idx ON sorteos (user_id, created_at DESC)`;
    })().catch((e) => {
      ready = null; // permite reintentar si falló
      throw e;
    });
  }
  return ready;
}

module.exports = { sql, ensureSchema };
