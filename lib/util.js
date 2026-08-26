// Utilidades compartidas por las funciones serverless.
const crypto = require("crypto");
const { sql, ensureSchema } = require("./db");
const { getSession } = require("./auth");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin caracteres ambiguos

function genCode(len = 8) {
  let s = "";
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

// Genera un código único que no exista ya en la tabla sorteos.
async function uniqueCode() {
  for (let i = 0; i < 6; i++) {
    const code = genCode(8);
    const { rows } = await sql`SELECT 1 FROM sorteos WHERE code = ${code}`;
    if (rows.length === 0) return code;
  }
  return genCode(12); // fallback prácticamente imposible de colisionar
}

// Devuelve el usuario autenticado (o null). No responde por sí sola.
async function currentUser(req) {
  const session = getSession(req);
  if (!session || !session.uid) return null;
  await ensureSchema();
  const { rows } = await sql`SELECT id, name, email FROM users WHERE id = ${session.uid}`;
  return rows[0] || null;
}

function readBody(req) {
  // Vercel ya parsea JSON en req.body cuando el content-type es application/json.
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return {};
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}

module.exports = { genCode, uniqueCode, currentUser, readBody, isEmail };
