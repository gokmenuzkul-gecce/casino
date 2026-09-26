import { io, Socket } from "socket.io-client";
import { getAccessToken } from "./api";

const URL = (import.meta.env.VITE_ENGINE_URL as string | undefined) ?? "";

/** A single shared socket; the token is refreshed before each reconnect attempt. */
export const socket: Socket = io(URL || undefined, {
  path: "/socket.io",
  transports: ["websocket", "polling"],
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 1500,
  auth: (cb) => cb({ token: getAccessToken() ?? "" }),
});

export function reconnectSocket(): void {
  socket.auth = { token: getAccessToken() ?? "" };
  if (socket.connected) socket.disconnect();
  socket.connect();
}

export { money } from "./api";
export type { Socket };
