const { sql, ensureSchema } = require("../../lib/db");
const { verifyPassword, setSession } = require("../../lib/auth");
const { readBody, isEmail } = require("../../lib/util");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });
  try {
    await ensureSchema();
    const { email, password } = readBody(req);
    const em = String(email || "").trim().toLowerCase();

    if (!isEmail(em) || !password)
      return res.status(400).json({ error: "Email o contraseña inválidos." });

    const { rows } = await sql`SELECT id, name, email, password_hash FROM users WHERE email = ${em}`;
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash))
      return res.status(401).json({ error: "Email o contraseña incorrectos." });

    setSession(res, user.id);
    return res.status(200).json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    console.error("login", e);
    return res.status(500).json({ error: "Error del servidor. Inténtalo de nuevo." });
  }
};
