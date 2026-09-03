// Utilidades para "conectar" Facebook/Instagram y leer comentarios de posts
// de una Página propia (para sortear entre los comentaristas). Sin librerías.
//
// Seguridad: el token de usuario de Facebook se guarda SOLO del lado del
// servidor, dentro de una cookie firmada (HMAC) y httpOnly, con caducidad.
// Nunca se envía al navegador. Los tokens de Página se re-derivan por pedido
// desde /me/accounts y tampoco se exponen al cliente.

const crypto = require("crypto");

const GRAPH = "https://graph.facebook.com/v19.0";
const SECRET = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";

// Permisos que pide el flujo de conexión (además de public_profile).
// pages_show_list        -> listar las Páginas que administra el usuario
// pages_read_engagement  -> leer posts y comentarios de esas Páginas
// instagram_basic        -> ver la cuenta de IG Business vinculada y su media
// instagram_manage_comments -> leer comentarios de la media de IG
const CONNECT_SCOPE = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_manage_comments",
].join(",");

/* ---------- firma de cookie con el token (integridad + caducidad) ---------- */
function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s) {
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
}
function hmac(data) {
  return b64url(crypto.createHmac("sha256", SECRET).update(data).digest());
}
function signToken(token, ttlMs = 60 * 60 * 1000) {
  const body = b64url(JSON.stringify({ t: token, exp: Date.now() + ttlMs }));
  return body + "." + hmac(body);
}
function verifyToken(value) {
  if (!value || value.indexOf(".") < 0) return null;
  const [body, sig] = value.split(".");
  const expected = hmac(body);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(unb64url(body));
    if (!p.exp || Date.now() > p.exp) return null;
    return p.t || null;
  } catch (e) { return null; }
}

/* ---------- cookie del token social ---------- */
const COOKIE = "social_tok";
function secureFlag() {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}
function setTokenCookie(token) {
  return `${COOKIE}=${signToken(token)}; HttpOnly; Path=/; Max-Age=3600; SameSite=Lax${secureFlag()}`;
}
function clearTokenCookie() {
  return `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secureFlag()}`;
}
function readTokenCookie(req) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? verifyToken(decodeURIComponent(m[1])) : null;
}

/* ---------- helper de la Graph API ---------- */
async function graph(path, params, token) {
  const usp = new URLSearchParams(params || {});
  usp.set("access_token", token);
  const r = await fetch(`${GRAPH}/${path}?${usp.toString()}`);
  const j = await r.json().catch(() => ({}));
  if (j && j.error) {
    const err = new Error(j.error.message || "Error de la Graph API");
    err.fbCode = j.error.code;
    err.status = r.status;
    throw err;
  }
  return j;
}

// Devuelve el access_token de una Página puntual (y datos útiles) a partir del
// token de usuario. Nunca se envía al cliente.
async function pageToken(userToken, pageId) {
  const j = await graph("me/accounts", {
    fields: "id,name,access_token,instagram_business_account{id,username}",
    limit: "200",
  }, userToken);
  const page = (j.data || []).find((p) => String(p.id) === String(pageId));
  return page || null;
}

module.exports = {
  GRAPH, CONNECT_SCOPE, graph, pageToken,
  setTokenCookie, clearTokenCookie, readTokenCookie,
  b64url, hmac, secureFlag,
};
