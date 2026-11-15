/*
 * Purpose: Development script: build one self-contained HTML file of the app (styles, fonts, icons and scripts inlined) for previews.
 * Responsibilities: Read index.html and inline every local stylesheet, font, icon and script into dist/notas-preview.html, and copy the
 * deployable static files into dist/notas-web/. The app itself has no build step: this only packages what is already there.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (f, enc = "utf8") => fs.readFileSync(path.join(ROOT, f), enc);
const dist = path.join(ROOT, "dist");
fs.mkdirSync(dist, { recursive: true });

let html = read("index.html");
const inlineCss = (file) => {
  let css = read(file);
  css = css.replace(/url\("\.\.\/fonts\/([^"]+)"\)/g, (_, f) => `url("data:font/woff2;base64,${read("fonts/" + f, "base64")}")`);
  return css;
};
html = html.replace(/<link rel="stylesheet" href="([^"]+)" \/>/g, (_, href) => `<style>\n${inlineCss(href)}\n</style>`);
html = html.replace(/<link rel="manifest"[^>]*>\n?\s*/, "");
html = html.replace(/<link rel="apple-touch-icon"[^>]*>\n?\s*/, "");
html = html.replace(/href="icons\/icon\.svg"/, `href="data:image/svg+xml;base64,${read("icons/icon.svg", "base64")}"`);
html = html.replace(
  /<script src="([^"]+)"><\/script>/g,
  (_, src) => `<script>\n${read(src).replace(/<\/script/gi, "<\\/script")}\n</script>`
);
// The preview frame refuses window.print and downloads: show the print layout on screen instead, with a close button.
const PREVIEW = `<style>
body[data-preview-print] #print-root { display: block; position: fixed; inset: 0; z-index: 50; overflow: auto; background: #fff; padding: 56px 16px 16px; }
body[data-preview-print] .app { display: none; }
#preview-close { position: fixed; top: 8px; right: 8px; z-index: 51; }
</style>
<script>
(function () {
  window.print = function () {
    document.body.setAttribute("data-preview-print", "1");
    var b = document.createElement("button");
    b.id = "preview-close";
    b.className = "primary";
    b.textContent = "Cerrar vista de impresión";
    b.onclick = function () {
      document.body.removeAttribute("data-preview-print");
      b.remove();
      window.dispatchEvent(new Event("afterprint"));
    };
    document.body.appendChild(b);
  };
})();
</script>`;
html = html.replace("</body>", PREVIEW + "\n</body>");
fs.writeFileSync(path.join(dist, "notas-preview.html"), html);

const web = path.join(dist, "notas-web");
fs.rmSync(web, { recursive: true, force: true });
const copy = (rel) => {
  const from = path.join(ROOT, rel);
  const to = path.join(web, rel);
  if (fs.statSync(from).isDirectory()) fs.cpSync(from, to, { recursive: true });
  else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
};
["index.html", "manifest.webmanifest", "sw.js", "css", "js", "backend", "fonts", "icons", "db/schema.sql", "README.md"].forEach(copy);
fs.writeFileSync(path.join(web, ".nojekyll"), "");
console.log("dist/notas-preview.html and dist/notas-web/ written");
