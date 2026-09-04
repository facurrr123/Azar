// Función única para el flujo social (Facebook/Instagram), para no pasar el
// límite de funciones serverless del plan Hobby. Despacha por el segmento de
// ruta [route]:
//   /api/social/connect   -> inicia el OAuth de conexión (permisos de Páginas/IG)
//   /api/social/callback   -> guarda el token en cookie firmada httpOnly
//   /api/social/data?action=... -> pages | posts | comments | ig-media |
//                                    ig-comments | status | disconnect
const crypto = require("crypto");
const { signState, verifyState, secureFlag } = require("../../lib/oauth");
const {
  CONNECT_SCOPE, graph, pageToken,
  setTokenCookie, clearTokenCookie, readTokenCookie,
} = require("../../lib/social");

const TOKEN_URL = "https://graph.facebook.com/v19.0/oauth/access_token";
const CAP = 2000, MAX_CALLS = 25;

function callbackUri(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `https://${host}/api/social/callback`;
}
function back(res, extra) {
  res.writeHead(302, { Location: "/?" + extra });
  res.end();
}
function excerpt(s, n = 90) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/* ------------------------- CONNECT (inicio OAuth) ------------------------- */
async function connect(req, res) {
  const clientId = process.env.FB_SOCIAL_CLIENT_ID || process.env.FACEBOOK_CLIENT_ID;
  if (!clientId) return res.status(500).send("La conexión con Facebook no está configurada (falta FB_SOCIAL_CLIENT_ID).");

  const nonce = crypto.randomBytes(16).toString("hex");
  const state = signState({ p: "social", n: nonce, exp: Date.now() + 10 * 60 * 1000 });
  res.setHeader("Set-Cookie", `social_nonce=${nonce}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secureFlag()}`);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUri(req),
    response_type: "code",
    scope: "public_profile," + CONNECT_SCOPE,
    state,
  });
  res.writeHead(302, { Location: `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}` });
  res.end();
}

/* ------------------------------ CALLBACK -------------------------------- */
async function callback(req, res) {
  try {
    const { code, state, error } = req.query;
    if (error) return back(res, "social=cancelled");
    if (!code || !state) return back(res, "social=error");

    const st = verifyState(state);
    const cookie = req.headers.cookie || "";
    const m = cookie.match(/(?:^|;\s*)social_nonce=([^;]+)/);
    if (!st || st.p !== "social" || !m || m[1] !== st.n) return back(res, "social=badstate");

    const clientId = process.env.FB_SOCIAL_CLIENT_ID || process.env.FACEBOOK_CLIENT_ID;
    const clientSecret = process.env.FB_SOCIAL_CLIENT_SECRET || process.env.FACEBOOK_CLIENT_SECRET;
    if (!clientId || !clientSecret) return back(res, "social=error");

    // code -> token de usuario (corta duración)
    const tokRes = await fetch(TOKEN_URL + "?" + new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      redirect_uri: callbackUri(req), code: String(code),
    }));
    const tok = await tokRes.json().catch(() => ({}));
    if (!tok.access_token) return back(res, "social=error");

    // corto -> larga duración (~60 días)
    let longToken = tok.access_token;
    try {
      const llRes = await fetch(TOKEN_URL + "?" + new URLSearchParams({
        grant_type: "fb_exchange_token", client_id: clientId,
        client_secret: clientSecret, fb_exchange_token: tok.access_token,
      }));
      const ll = await llRes.json().catch(() => ({}));
      if (ll.access_token) longToken = ll.access_token;
    } catch (e) { /* usamos el corto */ }

    res.setHeader("Set-Cookie", [
      setTokenCookie(longToken),
      `social_nonce=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secureFlag()}`,
    ]);
    return back(res, "social=connected");
  } catch (e) {
    console.error("social callback", e);
    res.setHeader("Set-Cookie", clearTokenCookie());
    return back(res, "social=error");
  }
}

/* -------------------------------- DATA ---------------------------------- */
async function data(req, res) {
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
    if (action === "pages") {
      const j = await graph("me/accounts", { fields: "id,name,instagram_business_account{id,username}", limit: "200" }, userToken);
      const pages = (j.data || []).map((p) => ({ id: p.id, name: p.name, hasInstagram: !!p.instagram_business_account }));
      return res.status(200).json({ pages });
    }

    if (action === "posts") {
      const page = await pageToken(userToken, req.query.pageId);
      if (!page) return res.status(404).json({ error: "No encuentro esa Página." });
      const j = await graph(`${page.id}/posts`, { fields: "id,message,created_time,permalink_url", limit: "25" }, page.access_token);
      const posts = (j.data || []).map((p) => ({ id: p.id, text: excerpt(p.message) || "(sin texto)", date: p.created_time, permalink: p.permalink_url || "" }));
      return res.status(200).json({ posts });
    }

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
          if (!from.name) return;
          const key = from.id || from.name;
          if (dedup) { if (seen.has(key)) return; seen.add(key); }
          names.push(from.name);
        });
        after = (j.paging && j.paging.next && j.paging.cursors && j.paging.cursors.after) || "";
        calls++;
      } while (after && names.length < CAP && calls < MAX_CALLS);

      return res.status(200).json({ count: names.length, participants: names.slice(0, CAP), truncated: names.length >= CAP });
    }

    if (action === "ig-media") {
      const page = await pageToken(userToken, req.query.pageId);
      if (!page) return res.status(404).json({ error: "No encuentro esa Página." });
      if (!page.instagram_business_account) return res.status(400).json({ error: "Esa Página no tiene una cuenta de Instagram Business vinculada." });
      const igId = page.instagram_business_account.id;
      const j = await graph(`${igId}/media`, { fields: "id,caption,media_type,timestamp,permalink", limit: "25" }, page.access_token);
      const media = (j.data || []).map((m) => ({ id: m.id, text: excerpt(m.caption) || "(sin texto)", date: m.timestamp, permalink: m.permalink || "", type: m.media_type }));
      return res.status(200).json({ igUsername: page.instagram_business_account.username || "", media });
    }

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
        after = (j.paging && j.paging.next && j.paging.cursors && j.paging.cursors.after) || "";
        calls++;
      } while (after && users.length < CAP && calls < MAX_CALLS);

      return res.status(200).json({ count: users.length, participants: users.slice(0, CAP), truncated: users.length >= CAP });
    }

    return res.status(400).json({ error: "Acción no reconocida." });
  } catch (e) {
    console.error("social/data", action, e);
    const msg = e.fbCode === 190 ? "Tu conexión con Facebook expiró. Volvé a conectar." : (e.message || "Error al consultar Facebook/Instagram.");
    return res.status(e.status && e.status >= 400 ? 400 : 500).json({ error: msg, needConnect: e.fbCode === 190 });
  }
}

/* ------------------------------ dispatcher ------------------------------ */
module.exports = async (req, res) => {
  const route = String(req.query.route || "");
  if (route === "connect") return connect(req, res);
  if (route === "callback") return callback(req, res);
  if (route === "data") return data(req, res);
  return res.status(404).json({ error: "No encontrado." });
};
