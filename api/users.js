// Perfiles Mi Plata: nombres CIFRADOS (AES-GCM), contrasenas hasheadas con salt,
// sesiones con token revocable y rol Admin (bootstrap: Admin / Evaluacion%2).
import { USERS, sha256hex, encStr, decStr, nameKey, passHash, tokenHash, readJson, writeJson, latest } from "./lib.js";

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
  // migracion de registros viejos (nombre en claro + hash cliente)
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
      // ---- login / registro / quien-soy (publicos)
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
        const nom = String(body.nombre || "").trim();
        if (nom.length < 3) return res.status(400).json({ error: "el usuario debe tener al menos 3 caracteres" });
        const email = String(body.email || "").trim(), tel = String(body.tel || "").trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "correo electrónico inválido" });
        if (!/^[+]?[0-9][0-9\s-]{6,18}$/.test(tel)) return res.status(400).json({ error: "número de teléfono inválido" });
        if (String(body.pass || "").length < 6) return res.status(400).json({ error: "la contraseña debe tener al menos 6 caracteres" });
        const nk = await nameKey(nom);
        if (reg.users.some(x => x.nameKey === nk)) return res.status(409).json({ error: "ese nombre de perfil ya existe" });
        const salt = await sha256hex("s::" + Date.now() + "::" + nom);
        const u = { id: (await sha256hex("uid::" + nom.toLowerCase())).slice(0, 12), nameKey: nk, nameEnc: await encStr(nom),
          emailEnc: await encStr(email), telEnc: await encStr(tel),
          salt, passHash: await passHash(salt, body.pass || ""), role: "user", blocked: false, sessions: [], createdAt: Date.now() };
        reg.users.push(u); await saveReg(sdk, reg);
        return res.status(200).json({ ok: true });
      }
      if (a === "forgot") {
        const nk = await nameKey(body.nombre || "");
        const u = reg.users.find(x => x.nameKey === nk);
        if (!u) return res.status(404).json({ error: "perfil no encontrado" });
        reg.requests = reg.requests || [];
        reg.requests.push({ id: "r" + Date.now(), uid: u.id, ts: Date.now(), contacto: await encStr(String(body.contacto || "").slice(0, 120)) });
        reg.requests = reg.requests.slice(-20);
        await saveReg(sdk, reg);
        return res.status(200).json({ ok: true, msg: "solicitud enviada al Admin" });
      }
      if (a === "who") { const u = await acc(body.token); if (!u) return res.status(401).json({ error: "sesion expirada" }); return res.status(200).json({ perfil: await perfilDe(u) }); }

      // ---- solo Admin
      const adm = await acc(body.token);
      if (!adm || adm.role !== "admin") return res.status(403).json({ error: "solo Admin" });
      const find = id => reg.users.find(x => x.id === id);
      if (a === "list") {
        const out = [];
        for (const u of reg.users) { const p = await perfilDe(u);
          try { p.email = u.emailEnc ? await decStr(u.emailEnc) : ""; p.tel = u.telEnc ? await decStr(u.telEnc) : ""; } catch (e) { p.email = p.tel = ""; }
          out.push(p); }
        const reqs = [];
        for (const r of (reg.requests || [])) { const uu = reg.users.find(x => x.id === r.uid);
          reqs.push({ id: r.id, uid: r.uid, ts: r.ts, nombre: uu ? (await perfilDe(uu)).nombre : "?", contacto: await decStr(r.contacto).catch(() => "") }); }
        return res.status(200).json({ users: out, requests: reqs });
      }
      if (a === "delreq") { reg.requests = (reg.requests || []).filter(r => r.id !== body.id); await saveReg(sdk, reg); return res.status(200).json({ ok: true }); }
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
