const { currentUser } = require("../../lib/util");

module.exports = async (req, res) => {
  try {
    const user = await currentUser(req);
    return res.status(200).json({ user: user || null });
  } catch (e) {
    console.error("me", e);
    return res.status(200).json({ user: null });
  }
};
