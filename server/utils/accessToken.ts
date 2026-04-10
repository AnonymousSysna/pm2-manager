const jwt = require("jsonwebtoken");
const { getTokenVersion } = require("./authSessionStore");

function verifyAccessToken(token, secret) {
  const decoded = jwt.verify(token, secret);
  if (decoded?.tokenType && decoded.tokenType !== "access") {
    throw new Error("Invalid token type");
  }

  const currentTokenVersion = getTokenVersion(decoded?.username);
  const tokenVersion = Number.isInteger(decoded?.tokenVersion)
    ? decoded.tokenVersion
    : 0;
  if (tokenVersion !== currentTokenVersion) {
    throw new Error("Revoked token");
  }

  return decoded;
}

module.exports = {
  verifyAccessToken
};
