import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, copyFile, cp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(projectRoot, "public", "vision");
const packages = path.join(projectRoot, "node_modules");
const mediaPipeRoot = path.join(packages, "@mediapipe", "tasks-vision");
const openCvRoot = path.join(packages, "@techstark", "opencv-js");
const modelUrl = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

await mkdir(output, { recursive: true });
await copyFile(path.join(openCvRoot, "dist", "opencv.js"), path.join(output, "opencv.js"));
await cp(path.join(mediaPipeRoot, "wasm"), path.join(output, "wasm"), { recursive: true });

// MediaPipe packages have used both a UMD .js and a CommonJS .cjs entry point.
// Wrap the latter so a classic worker can load the runtime without Node or CDN code.
const classicEntry = path.join(mediaPipeRoot, "vision_bundle.js");
const commonJsEntry = path.join(mediaPipeRoot, "vision_bundle.cjs");
if (await exists(classicEntry)) {
  await copyFile(classicEntry, path.join(output, "vision_bundle.js"));
} else if (await exists(commonJsEntry)) {
  const source = await readFile(commonJsEntry, "utf8");
  await writeFile(path.join(output, "vision_bundle.js"), `(function(){var exports={};var module={exports:exports};\n${source}\nself.vision=module.exports;\n})();\n`);
} else {
  throw new Error("The installed MediaPipe package has no supported classic-worker bundle.");
}

const modelFile = path.join(output, "face_landmarker.task");
if (!(await exists(modelFile)) || (await stat(modelFile)).size < 1000000) {
  console.log("Downloading the official face-landmarker model for offline use...");
  const response = await fetch(modelUrl, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 1000000 || bytes[0] !== 0 || bytes[1] !== 0) {
    // Model bundles start with two alignment bytes then ZIP magic (not an HTML error page).
    if (bytes.length < 1000000 || !(bytes[0] === 80 && bytes[1] === 75)) throw new Error("Downloaded model is not a valid task bundle.");
  }
  await writeFile(modelFile + ".download", bytes);
  await rename(modelFile + ".download", modelFile);
}

const mediaPipePackage = JSON.parse(await readFile(path.join(mediaPipeRoot, "package.json"), "utf8"));
const openCvPackage = JSON.parse(await readFile(path.join(openCvRoot, "package.json"), "utf8"));
for (const [folder, name] of [[mediaPipeRoot, "MEDIAPIPE"], [openCvRoot, "OPENCV"]]) {
  for (const candidate of ["LICENSE", "LICENSE.txt", "LICENSE.md"]) {
    if (await exists(path.join(folder, candidate))) {
      await copyFile(path.join(folder, candidate), path.join(output, `LICENSE-${name}.txt`));
      break;
    }
  }
}
await writeFile(path.join(output, "manifest.json"), JSON.stringify({
  mediaPipeVersion: mediaPipePackage.version,
  openCvVersion: openCvPackage.version,
  modelSource: modelUrl,
  modelSha256: await hashFile(modelFile),
  modelBytes: (await stat(modelFile)).size,
  privacy: "The installed app reads these local files. No CDN or model download occurs at runtime.",
}, null, 2) + "\n");
console.log("Offline camera assets ready: OpenCV, MediaPipe WASM, and face-landmarker model.");
