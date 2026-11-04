// Zero-dependency static server for local hosting: node server/static.mjs  (PORT default 3000)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../web/public", import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };

http.createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (p.includes("..")) { res.writeHead(400); return res.end(); }
  if (p.endsWith("/")) p += "index.html";
  try {
    const data = await readFile(join(DIR, p));
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(PORT, () => console.log(`Census 2030 demo: http://localhost:${PORT}`));
