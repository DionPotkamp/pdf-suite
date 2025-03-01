/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");

const paths = [path.resolve(__dirname, "..", "dist")];
let count = 0;

paths.forEach((p) => {
  if (!fs.existsSync(p)) return;

  fs.rmSync(p, { recursive: true, force: true });
  count++;
});

console.log(`Cleaned ${count} directories`);
