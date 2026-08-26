// Configuración y utilidades OAuth 2.0 (Google y Facebook), sin librerías.
const crypto = require("crypto");

const SECRET = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";

const PROVIDERS = {
  google: {
    label: "Google",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
    idEnv: "GOOGLE_CLIENT_ID",
    secretEnv: "GOOGLE_CLIENT_SECRET",
    extraAuth: { access_type: "online", prompt: "select_account" },
    parseUser: (u) => ({
      email: String(u.email || "").toLowerCase(),
      name: u.name || u.given_name || "Usuario",
    }),
  },
  facebook: {
    label: "Facebook",
    authorize: "https://www.facebook.com/v19.0/dialog/oauth",
    token: "https://graph.facebook.com/v19.0/oauth/access_token",
    userinfo: "https://graph.facebook.com/me?fields=id,name,email",
    scope: "email public_profile",
    idEnv: "FACEBOOK_CLIENT_ID",
    secretEnv: "FACEBOOK_CLIENT_SECRET",
    extraAuth: {},
    parseUser: (u) => ({
      email: String(u.email || "").toLowerCase(),
      name: u.name || "Usuario",
    }),
  },
};

/* ---- state firmado (anti-CSRF, con caducidad) ---- */
function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function hmac(data) {
  return b64url(crypto.createHmac("sha256", SECRET).update(data).digest());
}
function signState(payload) {
  const body = b64url(JSON.stringify(payload));
  return body + "." + hmac(body);
}
function verifyState(token) {
  if (!token || token.indexOf(".") < 0) return null;
  const [body, sig] = token.split(".");
  const expected = hmac(body);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch (e) {
    return null;
  }
}

function secureFlag() {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}
function redirectUri(req, provider) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `https://${host}/api/oauth/${provider}/callback`;
}

module.exports = { PROVIDERS, signState, verifyState, secureFlag, redirectUri };
