import { env } from "./env.js";
import { createAppServer } from "./app.js";

const { httpServer } = createAppServer();

httpServer.listen(env.PORT, () => {
  console.log(`[BandScroll] server listening on http://localhost:${env.PORT}`);
  console.log(`[BandScroll] uploads dir: ${env.UPLOAD_DIR}`);
  console.log(`[BandScroll] env: ${env.NODE_ENV}`);
  console.log(
    `[BandScroll] storage: ${env.STORAGE}${
      env.STORAGE === "file" ? ` (${env.DATA_DIR}/sessions.json)` : ""
    }`
  );
});
