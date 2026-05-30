import http from "http";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { config } from "./config";
import { logger } from "./logger";
import { initStore } from "./store";
import { router } from "./routes";
import { handleWsMessage, handleWsClose } from "./wsHandler";

async function main() {
  await initStore();

  const app = express();
  app.use(
    cors({
      origin: [config.publicWebUrl, "http://localhost:3000"],
      credentials: true,
    })
  );
  app.use(express.json({ limit: "15mb" }));
  app.use("/api", router);

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: config.wsPath });

  wss.on("connection", (ws) => {
    logger.debug("WS client connected");
    ws.on("message", (data) => {
      handleWsMessage(ws, data.toString());
    });
    ws.on("close", () => handleWsClose(ws));
    ws.on("error", (err) => logger.error({ err }, "WS error"));
  });

  server.listen(config.port, () => {
    logger.info(
      { port: config.port, wsPath: config.wsPath },
      "AI Interview API listening"
    );
  });
}

main().catch((err) => {
  logger.fatal({ err }, "Server failed to start");
  process.exit(1);
});
