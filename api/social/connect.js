// Inicia el flujo de CONEXIÓN de Facebook (distinto del login): pide permisos
// de Páginas/Instagram para poder leer comentarios y sortear entre ellos.
const crypto = require("crypto");
const { signState, secureFlag } = require("../../lib/oauth");
const { CONNECT_SCOPE } = require("../../lib/social");

function callbackUri(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `https://${host}/api/social/callback`;
}

module.exports = async (req, res) => {
  const clientId = process.env.FACEBOOK_CLIENT_ID;
  if (!clientId) {
    return res.status(500).send("La conexión con Facebook no está configurada (falta FACEBOOK_CLIENT_ID).");
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  const state = signState({ p: "social", n: nonce, exp: Date.now() + 10 * 60 * 1000 });

  res.setHeader("Set-Cookie",
    `social_nonce=${nonce}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secureFlag()}`);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUri(req),
    response_type: "code",
    scope: "public_profile," + CONNECT_SCOPE,
    state,
  });

  res.writeHead(302, { Location: `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}` });
  res.end();
};
