// API minima de sincronizacion: un solo JSON en Vercel KV.
// GET  /api/data -> { updatedAt, state } | null
// PUT  /api/data <- { updatedAt, state }
import { kv } from "@vercel/kv";

const CLAVE = "miplata:v1";

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const d = await kv.get(CLAVE);
      return res.status(200).json(d || null);
    } catch (e) {
      return res.status(500).json({ error: "kv GET falló: revisa que el proyecto tenga un KV conectado" });
    }
  }
  if (req.method === "PUT" || req.method === "POST") {
    try {
      let b = req.body;
      if (typeof b === "string") b = JSON.parse(b);
      if (!b || !b.state || !b.state.abierto) return res.status(400).json({ error: "estado inválido" });
      await kv.set(CLAVE, b);
      return res.status(200).json({ ok: true, updatedAt: b.updatedAt });
    } catch (e) {
      return res.status(500).json({ error: "kv PUT falló: revisa que el proyecto tenga un KV conectado" });
    }
  }
  return res.status(405).json({ error: "método no permitido" });
}
