// Eliminación de cuenta: borra el usuario y (por cascada) todos sus sorteos.
const { sql } = require("../lib/db");
const { currentUser } = require("../lib/util");
const { clearSession } = require("../lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "DELETE" && req.method !== "POST")
    return res.status(405).json({ error: "Método no permitido." });
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Necesitas iniciar sesión." });

    // ON DELETE CASCADE en la tabla sorteos borra también sus sorteos.
    await sql`DELETE FROM users WHERE id = ${user.id}`;
    clearSession(res);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("account delete", e);
    return res.status(500).json({ error: "Error del servidor." });
  }
};
