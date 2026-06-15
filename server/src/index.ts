import { env } from "./env.js";
import { createAppServer } from "./app.js";

const { httpServer } = createAppServer();

httpServer.listen(env.PORT, () => {
  console.log(`[play-a-sync] server listening on http://localhost:${env.PORT}`);
  console.log(`[play-a-sync] uploads dir: ${env.UPLOAD_DIR}`);
  console.log(`[play-a-sync] env: ${env.NODE_ENV}`);
});
