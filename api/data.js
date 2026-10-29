// Estado financiero por perfil, protegido por token de sesion (o Admin).
// GET  /api/data?u=<uid>  con header x-token
// PUT  /api/data?u=<uid>  con header x-token
import { USERS, sha256hex, tokenHash, readJson, writeJson } from "./lib.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const sdk = await import("@vercel/blob");
    const url = new URL(req.url, "http://local");
    const u = (url.searchParams.get("u") || "").match(/^[a-z0-9-]{1,40}$/);
    const PREFIX = u ? "miplata-u-" + u[0] + "-" : "miplata-v1-";
    // autorizacion: token de sesion del dueno del perfil (o Admin)
    const tok = req.headers["x-token"] || "";
    if (tok && u) {
      const reg = (await readJson(sdk, USERS)) || { users: [] };
      const th = tokenHash(tok);
      const owner = reg.users.find(x => x.id === u[0] && (x.sessions || []).includes(th) && !x.blocked);
      const admin = reg.users.find(x => x.role === "admin" && (x.sessions || []).includes(th) && !x.blocked);
      if (!owner && !admin) return res.status(401).json({ error: "sesion invalida para este perfil" });
    } else if (u) {
      return res.status(401).json({ error: "falta token de sesion" });
    }
    if (req.method === "GET") {
      const d = await readJson(sdk, PREFIX);
      return res.status(200).json(d || null);
    }
    if (req.method === "PUT" || req.method === "POST") {
      let b = req.body; if (typeof b === "string") b = JSON.parse(b);
      if (!b || !b.state || !b.state.abierto) return res.status(400).json({ error: "estado inválido" });
      await writeJson(sdk, PREFIX, b);
      return res.status(200).json({ ok: true, updatedAt: b.updatedAt });
    }
    return res.status(405).json({ error: "método no permitido" });
  } catch (e) { return res.status(500).json({ error: String((e && e.message) || e) }); }
}
