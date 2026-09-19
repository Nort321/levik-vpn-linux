import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const version = "v26.7.28";
const asset = "Xray-linux-64.zip";
const sha256 = "8195d909f1109b8f3d99eefe401a3c451d7bf4af71f24d3815420f77e5dd2a40";
const destination = "vendor/xray/linux-x64";
const archive = "vendor/xray/Xray-linux-64.zip";
await mkdir(destination, { recursive: true });
const response = await fetch(`https://github.com/XTLS/Xray-core/releases/download/${version}/${asset}`);
if (!response.ok) throw new Error(`Xray download failed: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("Xray SHA-256 mismatch");
await writeFile(archive, bytes);
await promisify(execFile)("unzip", ["-oq", archive, "xray", "geoip.dat", "geosite.dat", "LICENSE", "-d", destination]);
const manifest = JSON.parse(await readFile("native/xray-integrity.json", "utf8"));
for (const [name, expected] of Object.entries(manifest)) {
  const actual = createHash("sha256").update(await readFile(`${destination}/${name}`)).digest("hex");
  if (actual !== expected) throw new Error(`Pinned Xray file integrity mismatch: ${name}`);
}
await chmod(`${destination}/xray`, 0o755);
await writeFile(`${destination}/VERSION`, `${version}\n`);
await rm(archive);
console.log(`Verified ${asset} ${version}: ${sha256}`);
