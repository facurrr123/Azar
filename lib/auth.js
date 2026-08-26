// Autenticación propia y ligera: hash de contraseñas con scrypt y sesiones
// firmadas (HMAC) guardadas en una cookie httpOnly. Sin dependencias externas.
const crypto = require("crypto");

const SECRET = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
const COOKIE = "azar_session";
const MAX_AGE = 30 * 24 * 60 * 60; // 30 días en segundos

/* ---------- contraseñas ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = crypto.scryptSync(String(pw), salt, 64).toString("hex");
  return `scrypt$${salt}$${key}`;
}

function verifyPassword(pw, stored) {
  try {
    const [scheme, salt, key] = String(stored).split("$");
    if (scheme !== "scrypt" || !salt || !key) return false;
    const test = crypto.scryptSync(String(pw), salt, 64);
    const orig = Buffer.from(key, "hex");
    return test.length === orig.length && crypto.timingSafeEqual(test, orig);
  } catch (e) {
    return false;
  }
}

/* ---------- tokens de sesión ---------- */
function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function hmac(data) {
  return b64url(crypto.createHmac("sha256", SECRET).update(data).digest());
}
function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  return body + "." + hmac(body);
}
function verifyToken(token) {
  if (!token || token.indexOf(".") < 0) return null;
  const [body, sig] = token.split(".");
  const expected = hmac(body);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
    );
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

/* ---------- cookies ---------- */
// Devuelve la cadena de la cookie de sesión (útil para combinar varias cookies
// en una sola respuesta, p. ej. en el callback de OAuth).
function sessionCookie(uid) {
  const token = signToken({ uid, exp: Date.now() + MAX_AGE * 1000 });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`;
}
function setSession(res, uid) {
  res.setHeader("Set-Cookie", sessionCookie(uid));
}
function clearSession(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie",
    `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`);
}
function getSession(req) {
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)azar_session=([^;]+)/);
  if (!m) return null;
  return verifyToken(decodeURIComponent(m[1]));
}

module.exports = {
  hashPassword, verifyPassword,
  setSession, sessionCookie, clearSession, getSession,
};
