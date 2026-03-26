const jwt = require("jsonwebtoken");

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res
      .status(401)
      .json({ success: false, data: null, error: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "dev-secret-key"
    );
    req.user = decoded;
    return next();
  } catch (error) {
    return res
      .status(401)
      .json({ success: false, data: null, error: "Invalid token" });
  }
}

module.exports = { verifyToken };
