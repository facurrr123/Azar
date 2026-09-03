// Callback de la CONEXIÓN de Facebook: intercambia el code por un token de
// usuario, lo cambia por uno de larga duración y lo guarda en una cookie
// firmada httpOnly. Luego vuelve a la app. No crea sesión de login.
const { verifyState, secureFlag } = require("../../lib/oauth");
const { setTokenCookie, clearTokenCookie } = require("../../lib/social");

const TOKEN_URL = "https://graph.facebook.com/v19.0/oauth/access_token";

function callbackUri(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `https://${host}/api/social/callback`;
}
function back(res, extra) {
  res.writeHead(302, { Location: "/?" + extra });
  res.end();
}

module.exports = async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return back(res, "social=cancelled");
    if (!code || !state) return back(res, "social=error");

    // Validar state firmado + nonce en cookie (anti-CSRF)
    const st = verifyState(state);
    const cookie = req.headers.cookie || "";
    const m = cookie.match(/(?:^|;\s*)social_nonce=([^;]+)/);
    if (!st || st.p !== "social" || !m || m[1] !== st.n) {
      return back(res, "social=badstate");
    }

    const clientId = process.env.FACEBOOK_CLIENT_ID;
    const clientSecret = process.env.FACEBOOK_CLIENT_SECRET;
    if (!clientId || !clientSecret) return back(res, "social=error");

    // 1) code -> token de usuario (corta duración)
    const tokRes = await fetch(TOKEN_URL + "?" + new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUri(req),
      code: String(code),
    }));
    const tok = await tokRes.json().catch(() => ({}));
    if (!tok.access_token) return back(res, "social=error");

    // 2) token corto -> token de larga duración (~60 días)
    let longToken = tok.access_token;
    try {
      const llRes = await fetch(TOKEN_URL + "?" + new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: clientId,
        client_secret: clientSecret,
        fb_exchange_token: tok.access_token,
      }));
      const ll = await llRes.json().catch(() => ({}));
      if (ll.access_token) longToken = ll.access_token;
    } catch (e) { /* si falla, usamos el corto */ }

    // 3) guardar token en cookie firmada httpOnly + limpiar nonce
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
};
