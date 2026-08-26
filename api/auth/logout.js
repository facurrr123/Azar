const { clearSession } = require("../../lib/auth");

module.exports = async (req, res) => {
  clearSession(res);
  return res.status(200).json({ ok: true });
};
