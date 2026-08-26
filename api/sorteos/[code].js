// Consulta pública de un sorteo por su código (para verificación).
const { sql, ensureSchema } = require("../../lib/db");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido." });
  try {
    await ensureSchema();
    const code = String(req.query.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ error: "Código faltante." });

    const { rows } = await sql`
      SELECT s.code, s.title, s.winners, s.participant_count, s.created_at, u.name AS owner
      FROM sorteos s JOIN users u ON u.id = s.user_id
      WHERE s.code = ${code}`;

    if (!rows.length) return res.status(404).json({ error: "Sorteo no encontrado." });
    return res.status(200).json({ sorteo: rows[0] });
  } catch (e) {
    console.error("sorteo/code", e);
    return res.status(500).json({ error: "Error del servidor." });
  }
};
