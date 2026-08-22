import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(root, "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function mustContain(relativePath, needles) {
  const text = read(relativePath);
  for (const needle of needles) {
    if (!text.includes(needle)) {
      throw new Error(`${relativePath} is missing ${JSON.stringify(needle)}`);
    }
  }
}

function mustExist(relativePath) {
  const info = statSync(join(root, relativePath));
  if (!info.isFile() || info.size === 0) {
    throw new Error(`${relativePath} is missing or empty`);
  }
}

mustContain("public/CNAME", ["omadesk.mdtrr.com"]);
mustContain("public/robots.txt", ["https://omadesk.mdtrr.com/sitemap.xml"]);
mustContain("public/sitemap.xml", ["https://omadesk.mdtrr.com/"]);
mustContain("public/_redirects", ["/*    /index.html   200"]);
mustContain("public/404.html", ["window.location.replace"]);
mustContain("index.html", [
  'src="/src/main.tsx"',
  'content="https://omadesk.mdtrr.com/"',
]);
mustContain("src/site.ts", [
  'export const publicSiteOrigin = "https://omadesk.mdtrr.com"',
  "omarchy plugin add https://github.com/modoterra/omadesk.git --enable",
  "https://github.com/modoterra/omadesk",
]);
mustContain("package.json", ['"build": "tsc -b && vite build"']);
mustExist("public/preview.png");
mustExist("public/favicon.svg");

const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
if (!readme.includes("https://omadesk.mdtrr.com")) {
  throw new Error("README.md is missing the public site URL");
}
if (!readme.includes("Root directory") || !readme.includes("`www`")) {
  throw new Error("README.md is missing Cloudflare Pages settings");
}

console.log("site verification ok");
