const crypto = require("crypto");
const { sql, ensureSchema } = require("../../lib/db");
const { currentUser, uniqueCode, readBody } = require("../../lib/util");

module.exports = async (req, res) => {
  try {
    await ensureSchema();
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Necesitas iniciar sesión." });

    /* ---- listar mis sorteos ---- */
    if (req.method === "GET") {
      const { rows } = await sql`
        SELECT code, title, winners, participant_count, created_at
        FROM sorteos WHERE user_id = ${user.id}
        ORDER BY created_at DESC LIMIT 100`;
      return res.status(200).json({ sorteos: rows });
    }

    /* ---- crear un sorteo ---- */
    if (req.method === "POST") {
      const { title, participants, winners, animation } = readBody(req);
      const t = String(title || "Sorteo").trim().slice(0, 140) || "Sorteo";
      const parts = Array.isArray(participants)
        ? participants.map((p) => String(p)).filter(Boolean).slice(0, 200000)
        : [];
      const wins = Array.isArray(winners)
        ? winners.map((w) => String(w)).filter(Boolean).slice(0, 1000)
        : [];
      if (parts.length < 2) return res.status(400).json({ error: "Se necesitan al menos 2 participantes." });
      if (wins.length < 1) return res.status(400).json({ error: "Falta el ganador." });

      const id = crypto.randomUUID();
      const code = await uniqueCode();
      await sql`
        INSERT INTO sorteos (id, code, user_id, title, participants, winners, participant_count, animation)
        VALUES (${id}, ${code}, ${user.id}, ${t},
                ${JSON.stringify(parts)}::jsonb, ${JSON.stringify(wins)}::jsonb,
                ${parts.length}, ${String(animation || "").slice(0, 20)})`;

      return res.status(200).json({ code });
    }

    return res.status(405).json({ error: "Método no permitido." });
  } catch (e) {
    console.error("sorteos", e);
    return res.status(500).json({ error: "Error del servidor." });
  }
};
