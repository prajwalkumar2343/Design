import { parseFig, geometryBlobToSVGPath, getBlobBytes } from "openfig-core";
import { readFileSync } from "node:fs";

const bytes = new Uint8Array(readFileSync(process.argv[2] ?? "/tmp/figma-verify/brainstorm-session.fig"));
const doc = parseFig(bytes);
const key = (g) => `${g.sessionID}:${g.localID}`;
const paint = (p) => p && p.color ? `rgba(${(p.color.r*255).toFixed(0)},${(p.color.g*255).toFixed(0)},${(p.color.b*255).toFixed(0)},${p.color.a?.toFixed(2)})` : String(p?.type);
for (const n of doc.nodes) {
  const t = n.transform ? ` @(${n.transform.m02?.toFixed(1)},${n.transform.m12?.toFixed(1)}) rot?${(n.transform.m00 !== 1) ? ` m00=${n.transform.m00?.toFixed(3)} m01=${n.transform.m01?.toFixed(3)}` : ""}` : "";
  const fills = (n.fillPaints ?? []).map(paint).join(",");
  const strokes = (n.strokePaints ?? []).map(paint).join(",");
  const geo = n.fillGeometry ? ` fillGeo[${n.fillGeometry.length}]` : "";
  const sgeo = n.strokeGeometry ? ` strokeGeo[${n.strokeGeometry.length}]` : "";
  console.log(
    `${n.type} ${JSON.stringify(n.name)} size=${n.size ? `${n.size.x?.toFixed(0)}x${n.size.y?.toFixed(0)}` : "-"}${t}` +
    (fills ? ` fill=[${fills}]` : "") + (strokes ? ` stroke=[${strokes}] w=${n.strokeWeight}` : "") + geo + sgeo +
    (n.vectorData ? ` netBlob=${n.vectorData.vectorNetworkBlob}` : ""),
  );
}
console.log("--- geometry blobs ---");
doc.message.blobs.forEach((blob, i) => {
  try {
    const bytes = getBlobBytes(blob);
    const d = geometryBlobToSVGPath(bytes);
    console.log(`blob[${i}] len=${bytes.length} d=${d.slice(0, 300)}`);
  } catch { /* network blob */ }
});
