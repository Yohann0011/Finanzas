// API de sincronizacion: detecta sola el storage de Vercel que conectaste.
// Prioridad: Blob (versionado, sin problemas de cache/sobrescritura) > Redis/KV (Upstash REST).
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
async function getBlob() {
  const { list } = await import("@vercel/blob");
  const l = await list({ prefix: CLAVE + "-" });
  const latest = (l.blobs || []).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0] || null;
  if (!latest) return null;
  const r = await fetch(latest.url, { cache: "no-store" });
  return await r.json();
}
async function setBlob(value) {
  const { put, list, del } = await import("@vercel/blob");
  await put(CLAVE + "-" + Date.now() + ".json", JSON.stringify(value), { access: "public", addRandomSuffix: false });
  try {
    const l = await list({ prefix: CLAVE + "-" });
    const old = (l.blobs || []).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)).slice(5);
    if (old.length) await del(old.map(b => b.pathname));
  } catch (e) { /* limpieza opcional */ }
}
const provider = () => upstashVars() ? "redis" : (process.env.BLOB_READ_WRITE_TOKEN ? "blob" : null);

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
