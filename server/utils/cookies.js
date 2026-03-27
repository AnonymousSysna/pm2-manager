function parseCookieHeader(cookieHeader) {
  const raw = String(cookieHeader || "");
  if (!raw) {
    return {};
  }

  return raw.split(";").reduce((acc, part) => {
    const segment = part.trim();
    if (!segment) {
      return acc;
    }

    const index = segment.indexOf("=");
    if (index <= 0) {
      return acc;
    }

    const key = segment.slice(0, index).trim();
    const value = segment.slice(index + 1).trim();
    try {
      acc[key] = decodeURIComponent(value);
    } catch (_error) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

module.exports = { parseCookieHeader };
