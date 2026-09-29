import type { FastifyInstance } from "fastify";
import type { WsMessage } from "@cch/shared";
import type { Hub } from "../hub.js";

export function registerWebSocket(app: FastifyInstance, hub: Hub) {
  app.get("/ws", { websocket: true }, (socket) => {
    const send = (msg: WsMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    };
    send({ type: "hello", agents: hub.agents.list(), pending: hub.events.pending() });
    const unsubscribe = hub.bus.subscribe(send);
    const ping = setInterval(() => socket.readyState === socket.OPEN && socket.ping(), 20000);
    socket.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
    socket.on("error", () => socket.close());
    // The browser only listens; messages from it are ignored so the socket can't execute anything.
    socket.on("message", () => {});
  });
}
