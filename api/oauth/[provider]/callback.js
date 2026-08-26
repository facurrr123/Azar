// Callback OAuth: intercambia el code por un token, obtiene el perfil,
// y unifica/crea la cuenta por email. Luego inicia sesión y redirige a "/".
const crypto = require("crypto");
const { sql, ensureSchema } = require("../../../lib/db");
const { sessionCookie } = require("../../../lib/auth");
const { PROVIDERS, verifyState, secureFlag, redirectUri } = require("../../../lib/oauth");

function fail(res, msg) {
  res.writeHead(302, { Location: "/?autherror=" + encodeURIComponent(msg) });
  res.end();
}

module.exports = async (req, res) => {
  const provider = String(req.query.provider || "");
  const cfg = PROVIDERS[provider];
  try {
    if (!cfg) return fail(res, "Proveedor no soportado.");

    const { code, state, error } = req.query;
    if (error) return fail(res, "Acceso cancelado.");
    if (!code || !state) return fail(res, "Respuesta OAuth incompleta.");

    // Validar state firmado + nonce en cookie (anti-CSRF)
    const st = verifyState(state);
    const cookie = req.headers.cookie || "";
    const m = cookie.match(/(?:^|;\s*)oauth_nonce=([^;]+)/);
    if (!st || st.p !== provider || !m || m[1] !== st.n) {
      return fail(res, "Sesión de acceso inválida o expirada. Inténtalo de nuevo.");
    }

    const clientId = process.env[cfg.idEnv];
    const clientSecret = process.env[cfg.secretEnv];
    if (!clientId || !clientSecret) return fail(res, `${cfg.label} no está configurado.`);

    // 1) code -> access_token
    const tokenRes = await fetch(cfg.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        code: String(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(req, provider),
        grant_type: "authorization_code",
      }),
    });
    const tok = await tokenRes.json().catch(() => ({}));
    if (!tok.access_token) return fail(res, `No se pudo autenticar con ${cfg.label}.`);

    // 2) access_token -> perfil
    const uRes = await fetch(cfg.userinfo, { headers: { Authorization: "Bearer " + tok.access_token } });
    const profile = await uRes.json().catch(() => ({}));
    const u = cfg.parseUser(profile);
    if (!u.email) {
      return fail(res, `Tu cuenta de ${cfg.label} no comparte un email, así que no podemos crear la cuenta.`);
    }

    // 3) unificar por email (o crear)
    await ensureSchema();
    let { rows } = await sql`SELECT id, name, email FROM users WHERE email = ${u.email}`;
    let user = rows[0];
    if (!user) {
      const id = crypto.randomUUID();
      await sql`INSERT INTO users (id, name, email, password_hash)
                VALUES (${id}, ${u.name}, ${u.email}, ${"oauth$" + provider})`;
      user = { id, name: u.name, email: u.email };
    }

    // 4) iniciar sesión + limpiar nonce
    res.setHeader("Set-Cookie", [
      sessionCookie(user.id),
      `oauth_nonce=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secureFlag()}`,
    ]);
    res.writeHead(302, { Location: "/?welcome=1" });
    res.end();
  } catch (e) {
    console.error("oauth callback", e);
    return fail(res, "Error al iniciar sesión. Inténtalo de nuevo.");
  }
};
