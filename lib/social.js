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
// pages_show_list          -> listar las Páginas que administra el usuario
// pages_read_engagement    -> leer los posts publicados por la Página (listarlos)
// pages_read_user_content  -> leer el contenido de los usuarios: los COMENTARIOS
//                             de los posts de la Página (contenido generado por
//                             usuarios). Sin este, {post}/comments da (#200).
// instagram_basic          -> ver la cuenta de IG Business vinculada y su media
// instagram_manage_comments-> leer comentarios de la media de IG
// business_management      -> descubrir Páginas de un Portafolio comercial
const CONNECT_SCOPE = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "instagram_basic",
  "instagram_manage_comments",
  "business_management",
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

const PAGE_FIELDS = "id,name,access_token,instagram_business_account{id,username}";

// Lista TODAS las Páginas que administra el usuario: las personales (me/accounts)
// y las de sus Portafolios comerciales (owned_pages / client_pages). Las Páginas
// de un negocio NO aparecen en me/accounts; se descubren vía el negocio, para lo
// que hace falta el permiso business_management.
async function listAllPages(userToken) {
  const out = [], seen = new Set();
  const push = (p) => { if (p && p.id && !seen.has(String(p.id))) { seen.add(String(p.id)); out.push(p); } };

  try {
    const j = await graph("me/accounts", { fields: PAGE_FIELDS, limit: "200" }, userToken);
    (j.data || []).forEach(push);
  } catch (e) { /* seguimos con los negocios */ }

  try {
    const biz = await graph("me/businesses", { fields: "id", limit: "50" }, userToken);
    for (const b of (biz.data || [])) {
      for (const edge of ["owned_pages", "client_pages"]) {
        try {
          const j = await graph(`${b.id}/${edge}`, { fields: PAGE_FIELDS, limit: "200" }, userToken);
          (j.data || []).forEach(push);
        } catch (e) { /* ignorar este edge */ }
      }
    }
  } catch (e) { /* sin business_management: solo las personales */ }

  return out;
}

// Devuelve el access_token de una Página puntual (y datos útiles) a partir del
// token de usuario. Nunca se envía al cliente. Primero intenta leer la Página
// directamente por su ID (funciona incluso con Páginas de un negocio); si no,
// la busca en la lista completa.
async function pageToken(userToken, pageId) {
  try {
    const p = await graph(String(pageId), { fields: PAGE_FIELDS }, userToken);
    if (p && p.access_token) return p;
  } catch (e) { /* probamos por la lista */ }
  const pages = await listAllPages(userToken);
  return pages.find((p) => String(p.id) === String(pageId)) || null;
}

module.exports = {
  GRAPH, CONNECT_SCOPE, graph, pageToken, listAllPages,
  setTokenCookie, clearTokenCookie, readTokenCookie,
  b64url, hmac, secureFlag,
};
