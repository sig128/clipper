// Test environment. Imported first by every test file so config sees these values.
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(os.tmpdir(), "cf-server-test-"));
process.env.DATABASE_URL ??= "postgres://postgres@127.0.0.1:55432/clipforge_test";
process.env.MEDIA_DIR = path.join(tmp, "media");
process.env.WORK_DIR = path.join(tmp, "work");
process.env.PUBLIC_URL = "https://clipforge.test";
process.env.OWNER_TOKEN = "owner-test-token-0123456789abcdef";
process.env.JOBS = "off";
process.env.CLIPFORGE_NO_MAIN = "1";
process.env.UPLOAD_POST_API_KEY = "up_test_key";
process.env.TWITCH_CLIENT_ID = "tw_client";
process.env.TWITCH_CLIENT_SECRET = "tw_secret";
process.env.KICK_CLIENT_ID = "kick_client";
process.env.KICK_CLIENT_SECRET = "kick_secret";
export const TMP = tmp;
