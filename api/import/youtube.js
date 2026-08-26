// Importa los comentaristas de un video público de YouTube para usarlos como
// participantes de un sorteo. Usa la YouTube Data API v3 con una API key.
const { readBody } = require("../../lib/util");

function parseVideoId(input) {
  input = String(input || "").trim();
  if (/^[\w-]{11}$/.test(input)) return input;
  try {
    const u = new URL(input);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1, 12);
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const m = u.pathname.match(/\/(shorts|live|embed)\/([\w-]{11})/);
    if (m) return m[2];
  } catch (e) { /* no era URL */ }
  const m = input.match(/[\w-]{11}/);
  return m ? m[0] : null;
}

function apiError(reason) {
  const map = {
    commentsDisabled: "Los comentarios están desactivados en ese video.",
    videoNotFound: "No se encontró el video. Revisa la URL.",
    quotaExceeded: "Se alcanzó el límite diario de la API de YouTube. Inténtalo mañana.",
    dailyLimitExceeded: "Se alcanzó el límite diario de la API de YouTube.",
    keyInvalid: "La API key de YouTube no es válida (revisa la configuración).",
    forbidden: "YouTube no permitió leer estos comentarios.",
  };
  return map[reason] || null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });

  const KEY = process.env.YOUTUBE_API_KEY;
  if (!KEY) return res.status(500).json({ error: "La importación de YouTube aún no está configurada (falta YOUTUBE_API_KEY)." });

  try {
    const { url, keyword, dedupe } = readBody(req);
    const videoId = parseVideoId(url);
    if (!videoId) return res.status(400).json({ error: "No pude reconocer la URL del video de YouTube." });

    const kw = String(keyword || "").trim().toLowerCase();
    const dedup = dedupe !== false; // por defecto, un participante por persona
    const CAP = 2000, MAX_CALLS = 25;

    // Título del video (para prellenar el título del sorteo)
    let title = "";
    try {
      const vr = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${KEY}`);
      const vj = await vr.json();
      if (vj.items && vj.items[0]) title = vj.items[0].snippet.title;
    } catch (e) { /* no crítico */ }

    // Comentarios (páginas de 100)
    const names = [];
    const seen = new Set();
    let pageToken = "", calls = 0;
    do {
      const u = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&maxResults=100&order=time&videoId=${videoId}&key=${KEY}` +
        (pageToken ? `&pageToken=${pageToken}` : "");
      const r = await fetch(u);
      const j = await r.json();
      if (j.error) {
        const reason = j.error.errors && j.error.errors[0] && j.error.errors[0].reason;
        return res.status(r.status === 200 ? 400 : r.status).json({ error: apiError(reason) || "No se pudieron leer los comentarios." });
      }
      (j.items || []).forEach((it) => {
        const s = it.snippet && it.snippet.topLevelComment && it.snippet.topLevelComment.snippet;
        if (!s) return;
        if (kw && String(s.textDisplay || "").toLowerCase().indexOf(kw) === -1) return;
        const chId = (s.authorChannelId && s.authorChannelId.value) || s.authorDisplayName;
        if (dedup) { if (seen.has(chId)) return; seen.add(chId); }
        names.push(s.authorDisplayName);
      });
      pageToken = j.nextPageToken || "";
      calls++;
    } while (pageToken && names.length < CAP && calls < MAX_CALLS);

    return res.status(200).json({
      title,
      count: names.length,
      participants: names.slice(0, CAP),
      truncated: names.length >= CAP,
    });
  } catch (e) {
    console.error("import/youtube", e);
    return res.status(500).json({ error: "Error al importar de YouTube." });
  }
};
