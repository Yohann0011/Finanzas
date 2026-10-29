// Registro de perfiles Mi Plata.
// GET  /api/users -> { users:[{id,nombre,hash}], updatedAt }
// POST /api/users <- { id, nombre, hash }  (crea perfil nuevo)
const USERS = "miplata-users-";

async function latest(sdk, prefix) {
  const l = await sdk.list({ prefix });
  return (l.blobs || []).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0] || null;
}
async function readJson(sdk, prefix) {
  const b = await latest(sdk, prefix);
  if (!b) return null;
  try { const r = await fetch(b.url, { cache: "no-store" }); if (r.ok) return await r.json(); } catch (e) {}
  try { const r = await sdk.get(b.pathname, { access: "public" }); if (r && r.statusCode === 200 && r.stream) return JSON.parse(await new Response(r.stream).text()); } catch (e) {}
  const r2 = await sdk.get(b.pathname, { access: "private" });
  return (r2 && r2.statusCode === 200 && r2.stream) ? JSON.parse(await new Response(r2.stream).text()) : null;
}
async function writeJson(sdk, prefix, value) {
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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const sdk = await import("@vercel/blob");
    if (req.method === "GET") {
      const d = await readJson(sdk, USERS);
      return res.status(200).json(d || { users: [] });
    }
    if (req.method === "POST" || req.method === "PUT") {
      let b = req.body; if (typeof b === "string") b = JSON.parse(b);
      if (!b || !b.id || !b.nombre || !b.hash) return res.status(400).json({ error: "datos incompletos" });
      const reg = (await readJson(sdk, USERS)) || { users: [] };
      if (reg.users.some(u => u.nombre.toLowerCase() === String(b.nombre).toLowerCase()))
        return res.status(409).json({ error: "ese nombre de perfil ya existe" });
      reg.users.push({ id: String(b.id).slice(0, 24), nombre: String(b.nombre).slice(0, 40), hash: String(b.hash).slice(0, 80) });
      reg.updatedAt = Date.now();
      await writeJson(sdk, USERS, reg);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "método no permitido" });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}