// Builds the installable PWA into ../docs (GitHub Pages serves /docs).
// Usage: node build.mjs  (needs node_modules with react/recharts/lucide-react/esbuild/@tailwindcss/browser)
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const docs = join(here, "..", "docs");
mkdirSync(docs, { recursive: true });

execSync(
  `npx esbuild ${join(here, "src", "main.jsx")} --bundle --minify --format=iife ` +
  `--outfile=${join(docs, "app.js")} --loader:.jsx=jsx --jsx=automatic ` +
  `--define:process.env.NODE_ENV='"production"'`,
  { stdio: "inherit", cwd: here, env: { ...process.env, NODE_PATH: join(here, "node_modules") } }
);

const twSrc = [
  join(here, "node_modules", "@tailwindcss", "browser", "dist", "index.global.js"),
  join(here, "..", "node_modules", "@tailwindcss", "browser", "dist", "index.global.js"),
].find(existsSync);
if (!twSrc) throw new Error("@tailwindcss/browser not found — npm install first");
copyFileSync(twSrc, join(docs, "tw.js"));

const hash = createHash("sha256").update(readFileSync(join(docs, "app.js"))).digest("hex").slice(0, 10);

writeFileSync(join(docs, "manifest.webmanifest"), JSON.stringify({
  name: "PPL Tracker",
  short_name: "PPL",
  start_url: "./",
  scope: "./",
  display: "standalone",
  background_color: "#000000",
  theme_color: "#000000",
  icons: [
    { src: "./icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "./icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
}, null, 2));

writeFileSync(join(docs, "sw.js"), `// PPL Tracker service worker — app shell cache (build ${hash})
const CACHE = "ppl-${hash}";
const ASSETS = ["./", "./index.html", "./app.js", "./tw.js", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // sheet sync passes through
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put("./index.html", copy));
      return res;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
`);

writeFileSync(join(docs, "index.html"), `<!doctype html>
<html lang="en" style="background:#000">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="PPL">
<link rel="manifest" href="./manifest.webmanifest">
<link rel="apple-touch-icon" href="./icon-180.png">
<link rel="icon" href="./icon-192.png">
<title>PPL Tracker</title>
<style>html,body{margin:0;background:#000;color:#e4e4e7;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}</style>
</head>
<body>
<div id="root"><div style="padding:6rem 1rem;text-align:center;color:#71717a;font-size:14px">Loading PPL Tracker…</div></div>
<script src="./tw.js"></script>
<script src="./app.js"></script>
</body>
</html>
`);

console.log("PWA built into docs/ (cache " + hash + ")");
