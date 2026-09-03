// Datos sociales para armar el sorteo. Lee el token de la cookie firmada y
// consulta la Graph API. Acciones (?action=):
//   status      -> { connected }
//   pages       -> { pages: [{id, name, hasInstagram}] }
//   posts       -> { posts: [{id, text, date, permalink}] }            (?pageId)
//   comments    -> { count, participants:[nombre], truncated }         (?pageId&postId)
//   ig-media    -> { igUsername, media:[{id, text, date, permalink, type}] } (?pageId)
//   ig-comments -> { count, participants:[usuario], truncated }        (?pageId&mediaId)
//   disconnect  -> desconecta (borra la cookie)
const { graph, pageToken, readTokenCookie, clearTokenCookie } = require("../../lib/social");

const CAP = 2000, MAX_CALLS = 25;

function excerpt(s, n = 90) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

module.exports = async (req, res) => {
  const action = String(req.query.action || "");

  if (action === "disconnect") {
    res.setHeader("Set-Cookie", clearTokenCookie());
    return res.status(200).json({ ok: true });
  }

  const userToken = readTokenCookie(req);
  if (action === "status") return res.status(200).json({ connected: !!userToken });
  if (!userToken) return res.status(401).json({ error: "No estás conectado con Facebook.", needConnect: true });

  const kw = String(req.query.keyword || "").trim().toLowerCase();
  const dedup = req.query.dedupe !== "false";

  try {
    /* ---- Páginas que administra el usuario ---- */
    if (action === "pages") {
      const j = await graph("me/accounts", {
        fields: "id,name,instagram_business_account{id,username}",
        limit: "200",
      }, userToken);
      const pages = (j.data || []).map((p) => ({
        id: p.id,
        name: p.name,
        hasInstagram: !!p.instagram_business_account,
      }));
      return res.status(200).json({ pages });
    }

    /* ---- Posts de una Página ---- */
    if (action === "posts") {
      const page = await pageToken(userToken, req.query.pageId);
      if (!page) return res.status(404).json({ error: "No encuentro esa Página." });
      const j = await graph(`${page.id}/posts`, {
        fields: "id,message,created_time,permalink_url",
        limit: "25",
      }, page.access_token);
      const posts = (j.data || []).map((p) => ({
        id: p.id,
        text: excerpt(p.message) || "(sin texto)",
        date: p.created_time,
        permalink: p.permalink_url || "",
      }));
      return res.status(200).json({ posts });
    }

    /* ---- Comentarios de un post de Facebook ---- */
    if (action === "comments") {
      const page = await pageToken(userToken, req.query.pageId);
      if (!page) return res.status(404).json({ error: "No encuentro esa Página." });
      const postId = String(req.query.postId || "");
      if (!postId) return res.status(400).json({ error: "Falta el post." });

      const names = [], seen = new Set();
      let after = "", calls = 0;
      do {
        const params = { fields: "from{name,id},message", limit: "100", filter: "stream" };
        if (after) params.after = after;
        const j = await graph(`${postId}/comments`, params, page.access_token);
        (j.data || []).forEach((c) => {
          if (kw && String(c.message || "").toLowerCase().indexOf(kw) === -1) return;
          const from = c.from || {};
          const name = from.name;
          if (!name) return; // Meta a veces oculta el autor si no usó la app
          const key = from.id || name;
          if (dedup) { if (seen.has(key)) return; seen.add(key); }
          names.push(name);
        });
        after = (j.paging && j.paging.cursors && j.paging.cursors.after) || "";
        if (!(j.paging && j.paging.next)) after = "";
        calls++;
      } while (after && names.length < CAP && calls < MAX_CALLS);

      return res.status(200).json({ count: names.length, participants: names.slice(0, CAP), truncated: names.length >= CAP });
    }

    /* ---- Media (posts) de Instagram Business ---- */
    if (action === "ig-media") {
      const page = await pageToken(userToken, req.query.pageId);
      if (!page) return res.status(404).json({ error: "No encuentro esa Página." });
      if (!page.instagram_business_account) {
        return res.status(400).json({ error: "Esa Página no tiene una cuenta de Instagram Business vinculada." });
      }
      const igId = page.instagram_business_account.id;
      const j = await graph(`${igId}/media`, {
        fields: "id,caption,media_type,timestamp,permalink",
        limit: "25",
      }, page.access_token);
      const media = (j.data || []).map((m) => ({
        id: m.id,
        text: excerpt(m.caption) || "(sin texto)",
        date: m.timestamp,
        permalink: m.permalink || "",
        type: m.media_type,
      }));
      return res.status(200).json({ igUsername: page.instagram_business_account.username || "", media });
    }

    /* ---- Comentarios de un post de Instagram ---- */
    if (action === "ig-comments") {
      const page = await pageToken(userToken, req.query.pageId);
      if (!page) return res.status(404).json({ error: "No encuentro esa Página." });
      const mediaId = String(req.query.mediaId || "");
      if (!mediaId) return res.status(400).json({ error: "Falta el post de Instagram." });

      const users = [], seen = new Set();
      let after = "", calls = 0;
      do {
        const params = { fields: "from{username,id},text,username", limit: "50" };
        if (after) params.after = after;
        const j = await graph(`${mediaId}/comments`, params, page.access_token);
        (j.data || []).forEach((c) => {
          if (kw && String(c.text || "").toLowerCase().indexOf(kw) === -1) return;
          const uname = (c.from && c.from.username) || c.username;
          if (!uname) return;
          const key = (c.from && c.from.id) || uname;
          if (dedup) { if (seen.has(key)) return; seen.add(key); }
          users.push("@" + uname);
        });
        after = (j.paging && j.paging.cursors && j.paging.cursors.after) || "";
        if (!(j.paging && j.paging.next)) after = "";
        calls++;
      } while (after && users.length < CAP && calls < MAX_CALLS);

      return res.status(200).json({ count: users.length, participants: users.slice(0, CAP), truncated: users.length >= CAP });
    }

    return res.status(400).json({ error: "Acción no reconocida." });
  } catch (e) {
    console.error("social/data", action, e);
    const msg = e.fbCode === 190
      ? "Tu conexión con Facebook expiró. Volvé a conectar."
      : (e.message || "Error al consultar Facebook/Instagram.");
    return res.status(e.status && e.status >= 400 ? 400 : 500).json({ error: msg, needConnect: e.fbCode === 190 });
  }
};
