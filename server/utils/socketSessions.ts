const SOCKET_USER_ROOM_PREFIX = "user:";

function getUserSocketRoom(username) {
  return `${SOCKET_USER_ROOM_PREFIX}${String(username || "").trim()}`;
}

async function disconnectUserSockets(io, username) {
  const normalized = String(username || "").trim();
  if (!io || !normalized) {
    return 0;
  }

  const room = getUserSocketRoom(normalized);
  const sockets = await io.in(room).fetchSockets();
  for (const socket of sockets) {
    socket.disconnect(true);
  }
  return sockets.length;
}

module.exports = {
  getUserSocketRoom,
  disconnectUserSockets
};
