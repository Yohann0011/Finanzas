// Perfiles Mi Plata: nombres CIFRADOS (AES-GCM), contrasenas hasheadas con salt,
// sesiones con token revocable y rol Admin (bootstrap: Admin / Evaluacion%2).
import { USERS, sha256hex, encStr, decStr, nameKey, passHash, tokenHash, readJson, writeJson } from "./lib.js";

async function ensureAdmin(reg) {
  if (!reg.users.some(u => u.role === "admin")) {
    const salt = await sha256hex("s::" + Date.now() + "::admin");
    reg.users.push({
      id: "admin", nameKey: await nameKey("Admin"), nameEnc: await encStr("Admin"),
      salt, passHash: await passHash(salt, "Evaluacion%2"), role: "admin",
      blocked: false, sessions: [], createdAt: Date.now(),
    });
    reg.changed = true;
  }
  for (const u of reg.users) {
    if (u.nombre && !u.nameKey) {
      u.nameKey = await nameKey(u.nombre); u.nameEnc = await encStr(u.nombre);
      u.legacyHash = u.hash; delete u.nombre; delete u.hash; u.sessions = u.sessions || [];
      reg.changed = true;
    }
  }
  return reg;
}
async function loadReg(sdk) {
  const reg = (await readJson(sdk, USERS)) || { users: [] };
  await ensureAdmin(reg);
  return reg;
}
async function saveReg(sdk, reg) { delete reg.changed; reg.updatedAt = Date.now(); await writeJson(sdk, USERS, reg); }
const perfilDe = async u => ({ id: u.id, nombre: u.nameEnc ? await decStr(u.nameEnc) : "?", role: u.role || "user", blocked: !!u.blocked, createdAt: u.createdAt || 0 });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const sdk = await import("@vercel/blob");
    const reg = await loadReg(sdk);
    const body = req.method === "GET" ? {} : (typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}));
    const acc = async tok => { const th = await tokenHash(tok); return reg.users.find(u => (u.sessions || []).some(t => t === th) && !u.blocked); };

    if (req.method === "GET") return res.status(200).json({ ok: true, hint: "usa POST con action" });

    if (req.method === "POST" || req.method === "PUT") {
      const a = body.action;
      if (a === "login") {
        const nk = await nameKey(body.nombre || "");
        const u = reg.users.find(x => x.nameKey === nk);
        if (!u || u.blocked) return res.status(u && u.blocked ? 403 : 404).json({ error: u && u.blocked ? "perfil bloqueado" : "perfil no encontrado" });
        const ph = u.salt ? await passHash(u.salt, body.pass || "") : await sha256hex(String(body.nombre).toLowerCase() + "::" + (body.pass || ""));
        const ok = u.salt ? ph === u.passHash : (ph === (u.legacyHash || u.passHash));
        if (!ok) return res.status(401).json({ error: "contraseña incorrecta" });
        if (!u.salt) { u.salt = await sha256hex("s::" + Date.now() + "::" + u.id); u.passHash = await passHash(u.salt, body.pass || ""); delete u.legacyHash; }
        const token = (await sha256hex("tok::" + Date.now() + "::" + Math.random() + "::" + u.id)).slice(0, 48);
        u.sessions = [...(u.sessions || []), await tokenHash(token)].slice(-8);
        await saveReg(sdk, reg);
        return res.status(200).json({ token, perfil: await perfilDe(u) });
      }
      if (a === "register") {
        const nk = await nameKey(body.nombre || "");
        if (reg.users.some(x => x.nameKey === nk)) return res.status(409).json({ error: "ese nombre de perfil ya existe" });
        const salt = await sha256hex("s::" + Date.now() + "::" + body.nombre);
        const u = { id: (await sha256hex("uid::" + String(body.nombre).toLowerCase())).slice(0, 12), nameKey: nk, nameEnc: await encStr(body.nombre), salt, passHash: await passHash(salt, body.pass || ""), role: "user", blocked: false, sessions: [], createdAt: Date.now() };
        reg.users.push(u); await saveReg(sdk, reg);
        return res.status(200).json({ ok: true });
      }
      if (a === "who") { const u = await acc(body.token); if (!u) return res.status(401).json({ error: "sesion expirada" }); return res.status(200).json({ perfil: await perfilDe(u) }); }

      const adm = await acc(body.token);
      if (!adm || adm.role !== "admin") return res.status(403).json({ error: "solo Admin" });
      const find = id => reg.users.find(x => x.id === id);
      if (a === "list") { const out = []; for (const u of reg.users) out.push(await perfilDe(u)); return res.status(200).json({ users: out }); }
      if (a === "create") {
        const nk = await nameKey(body.nombre || "");
        if (reg.users.some(x => x.nameKey === nk)) return res.status(409).json({ error: "ya existe" });
        const salt = await sha256hex("s::" + Date.now() + "::" + body.nombre);
        reg.users.push({ id: (await sha256hex("uid::" + String(body.nombre).toLowerCase())).slice(0, 12), nameKey: nk, nameEnc: await encStr(body.nombre), salt, passHash: await passHash(salt, body.pass || ""), role: "user", blocked: false, sessions: [], createdAt: Date.now() });
        await saveReg(sdk, reg); return res.status(200).json({ ok: true });
      }
      if (a === "rename") { const u = find(body.id); if (!u) return res.status(404).json({ error: "no existe" }); u.nameKey = await nameKey(body.nombre); u.nameEnc = await encStr(body.nombre); await saveReg(sdk, reg); return res.status(200).json({ ok: true }); }
      if (a === "setpass") { const u = find(body.id); if (!u) return res.status(404).json({ error: "no existe" }); u.salt = await sha256hex("s::" + Date.now() + "::" + u.id); u.passHash = await passHash(u.salt, body.pass || ""); u.sessions = []; await saveReg(sdk, reg); return res.status(200).json({ ok: true }); }
      if (a === "setblock") { const u = find(body.id); if (!u) return res.status(404).json({ error: "no existe" }); if (u.role === "admin") return res.status(400).json({ error: "el Admin no se bloquea" }); u.blocked = !!body.blocked; u.sessions = []; await saveReg(sdk, reg); return res.status(200).json({ ok: true }); }
      if (a === "delete") { const u = find(body.id); if (!u) return res.status(404).json({ error: "no existe" }); if (u.role === "admin") return res.status(400).json({ error: "el Admin no se elimina" }); reg.users = reg.users.filter(x => x.id !== body.id); await saveReg(sdk, reg); return res.status(200).json({ ok: true }); }
      return res.status(400).json({ error: "action desconocida" });
    }
    return res.status(405).json({ error: "método no permitido" });
  } catch (e) { return res.status(500).json({ error: String((e && e.message) || e) }); }
}