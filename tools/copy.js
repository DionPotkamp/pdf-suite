/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");

const paths = [
  {
    src: path.resolve(__dirname, "..", "public"),
    dest: path.resolve(__dirname, "..", "dist"),
  },
  {
    src: path.resolve(
      __dirname,
      "..",
      "node_modules",
      "pdfjs-dist",
      "build",
      "pdf.worker.min.mjs"
    ),
    dest: path.resolve(__dirname, "..", "dist", "pdf-worker.mjs"),
  },
];
let count = 0;

paths.forEach((obj) => copyRecursive(obj.src, obj.dest));

console.log(`Copied ${count} directories`);

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);

  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest);

    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      const srcPath = path.join(src, entry);
      const destPath = path.join(dest, entry);
      copyRecursive(srcPath, destPath);
    }
  } else {
    fs.copyFileSync(src, dest);
  }

  count++;
}
