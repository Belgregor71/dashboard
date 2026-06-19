// Copies src/js/config.js -> static/js/config.js after every build.
//
// index.html loads /js/config.js as a plain (non-module) script so
// window.CONFIG is available before app.js runs - vite can't bundle that
// (it's not type="module"), so it has to exist as a real static file.
// Generating it here keeps src/js/config.js as the single source of
// truth instead of two hand-maintained copies drifting apart (which is
// exactly how this file went missing in production before).
import { copyFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, "..", "src", "js", "config.js");
const destDir = join(__dirname, "..", "static", "js");
const dest = join(destDir, "config.js");

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log("Copied src/js/config.js -> static/js/config.js");
