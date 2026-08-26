const crypto = require("crypto");
const { sql, ensureSchema } = require("../../lib/db");
const { hashPassword, setSession } = require("../../lib/auth");
const { readBody, isEmail } = require("../../lib/util");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });
  try {
    await ensureSchema();
    const { name, email, password } = readBody(req);
    const nm = String(name || "").trim();
    const em = String(email || "").trim().toLowerCase();

    if (!nm) return res.status(400).json({ error: "Ingresa tu nombre." });
    if (!isEmail(em)) return res.status(400).json({ error: "Ingresa un email válido." });
    if (!password || String(password).length < 6)
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });

    const existing = await sql`SELECT id FROM users WHERE email = ${em}`;
    if (existing.rows.length) return res.status(409).json({ error: "Ese email ya está registrado." });

    const id = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email, password_hash)
              VALUES (${id}, ${nm}, ${em}, ${hashPassword(password)})`;

    setSession(res, id);
    return res.status(200).json({ user: { id, name: nm, email: em } });
  } catch (e) {
    console.error("signup", e);
    return res.status(500).json({ error: "Error del servidor. Inténtalo de nuevo." });
  }
};
