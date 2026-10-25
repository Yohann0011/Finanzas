// API de sincronizacion Mi Plata. Funciona con Blob PRIVADO o publico, y con Redis/KV.
// GET  /api/data -> { updatedAt, state } | null
// PUT  /api/data <- { updatedAt, state }
const CLAVE = "miplata-v1";

const upstashVars = () =>
  (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
    ? [process.env.KV_REST_API_URL, process.env.KV_REST_API_TOKEN]
    : (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
      ? [process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN]
      : null;

async function getUpstash([url, token]) {
  const r = await fetch(url + "/get/" + encodeURIComponent(CLAVE), { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
  const j = await r.json();
  if (!j.result) return null;
  return typeof j.result === "string" ? JSON.parse(j.result) : j.result;
}
async function setUpstash([url, token], value) {
  const r = await fetch(url + "/set", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify([CLAVE, value]),
  });
  if (!r.ok) throw new Error("upstash set " + r.status);
}

// ---- Blob (privado o publico): cada guardado crea un archivo nuevo con marca de tiempo
async function latestBlob(list) {
  const l = await list({ prefix: CLAVE + "-" });
  return (l.blobs || []).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0] || null;
}
async function getBlob() {
  const sdk = await import("@vercel/blob");
  const latest = await latestBlob(sdk.list);
  if (!latest) return null;
  const r = await sdk.get(latest.pathname, {});
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  const text = await new Response(r.stream).text();
  return JSON.parse(text);
}
async function setBlob(value) {
  const sdk = await import("@vercel/blob");
  await sdk.put(CLAVE + "-" + Date.now() + ".json", JSON.stringify(value), { addRandomSuffix: false });
  try {
    const old = ((await latestBlobList(sdk)).slice(5));
    if (old.length) await sdk.del(old.map(b => b.pathname));
  } catch (e) { /* limpieza opcional */ }
}
async function latestBlobList(sdk) {
  const l = await sdk.list({ prefix: CLAVE + "-" });
  return (l.blobs || []).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

const provider = () => (process.env.BLOB_READ_WRITE_TOKEN ? "blob" : (upstashVars() ? "redis" : null));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const SIN = { error: "Sin almacenamiento conectado: en Vercel crea Storage (Blob o Redis) y conectalo a este proyecto." };
  try {
    if (req.method === "GET") {
      const p = provider();
      if (!p) return res.status(503).json(SIN);
      const d = p === "blob" ? await getBlob() : await getUpstash(upstashVars());
      return res.status(200).json(d || null);
    }
    if (req.method === "PUT" || req.method === "POST") {
      let b = req.body;
      if (typeof b === "string") b = JSON.parse(b);
      if (!b || !b.state || !b.state.abierto) return res.status(400).json({ error: "estado inválido" });
      const p = provider();
      if (!p) return res.status(503).json(SIN);
      if (p === "blob") await setBlob(b); else await setUpstash(upstashVars(), b);
      return res.status(200).json({ ok: true, updatedAt: b.updatedAt });
    }
    return res.status(405).json({ error: "método no permitido" });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
