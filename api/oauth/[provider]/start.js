// Inicia el flujo OAuth: redirige al proveedor (Google / Facebook).
const crypto = require("crypto");
const { PROVIDERS, signState, secureFlag, redirectUri } = require("../../../lib/oauth");

module.exports = async (req, res) => {
  const provider = String(req.query.provider || "");
  const cfg = PROVIDERS[provider];
  if (!cfg) return res.status(404).send("Proveedor no soportado.");

  const clientId = process.env[cfg.idEnv];
  if (!clientId) {
    return res.status(500).send(
      `El acceso con ${cfg.label} aún no está configurado (falta la variable ${cfg.idEnv}).`
    );
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  const state = signState({ p: provider, n: nonce, exp: Date.now() + 10 * 60 * 1000 });

  res.setHeader("Set-Cookie",
    `oauth_nonce=${nonce}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secureFlag()}`);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req, provider),
    response_type: "code",
    scope: cfg.scope,
    state,
  });
  Object.keys(cfg.extraAuth).forEach((k) => params.set(k, cfg.extraAuth[k]));

  res.writeHead(302, { Location: `${cfg.authorize}?${params.toString()}` });
  res.end();
};
