// Utilidades compartidas: blobs + cripto (nombres cifrados, hashes con salt, sesiones).
const USERS = "miplata-users-";
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = b => Buffer.from(b).toString("base64");
const unb64 = s => new Uint8Array(Buffer.from(s, "base64"));
export { USERS };

export async function sha256hex(t) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(t));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function aesKey() {
  // clave AES-256: los 32 bytes CRUDOS del digest (no el hex de 64 caracteres)
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(process.env.MIPLATA_SECRET || "miplata-default-v1"));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export async function encStr(s) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), enc.encode(s));
  return b64(iv) + ":" + b64(new Uint8Array(ct));
}
export async function decStr(p) {
  const [i, c] = String(p).split(":");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(i) }, await aesKey(), unb64(c));
  return dec.decode(pt);
}
export const nameKey = n => sha256hex("nk::" + String(n).toLowerCase());
export const passHash = (salt, pass) => sha256hex(salt + "::" + pass);
export const tokenHash = t => sha256hex("tk::" + t);

// ---- blobs (publico/privado adaptativo) ----
export async function latest(sdk, prefix) {
  const l = await sdk.list({ prefix });
  return (l.blobs || []).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0] || null;
}
export async function readJson(sdk, prefix) {
  const b = await latest(sdk, prefix);
  if (!b) return null;
  try { const r = await fetch(b.url, { cache: "no-store" }); if (r.ok) return await r.json(); } catch (e) {}
  try { const r = await sdk.get(b.pathname, { access: "public" }); if (r && r.statusCode === 200 && r.stream) return JSON.parse(await new Response(r.stream).text()); } catch (e) {}
  const r2 = await sdk.get(b.pathname, { access: "private" });
  return (r2 && r2.statusCode === 200 && r2.stream) ? JSON.parse(await new Response(r2.stream).text()) : null;
}
export async function writeJson(sdk, prefix, value) {
  const nombre = prefix + Date.now() + ".json";
  const cuerpo = JSON.stringify(value);
  try { await sdk.put(nombre, cuerpo, { addRandomSuffix: false, access: "public" }); }
  catch (e) {
    if (/access/i.test(String(e && e.message))) await sdk.put(nombre, cuerpo, { addRandomSuffix: false, access: "private" });
    else throw e;
  }
  try {
    const l = await sdk.list({ prefix });
    const old = (l.blobs || []).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)).slice(5);
    if (old.length) await sdk.del(old.map(b => b.pathname));
  } catch (e) {}
}
