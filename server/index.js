import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { db, usingPostgres } from "./db.js";
import { requireAuth, signToken } from "./auth.js";
import { analisarAtendimento } from "./ai.js";

const app = express();
const port = Number(process.env.PORT || 3001);

app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

const allowedOrigin = process.env.CORS_ORIGIN || "http://localhost:5173";
app.use(cors({ origin: allowedOrigin, credentials: false }));
app.use(express.json({ limit: "200kb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde alguns minutos." }
});

const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Limite temporário de análises atingido." }
});

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(128)
});

const loginSchema = z.object({
  email: z.string().trim().email().max(160),
  password: z.string().min(1).max(128)
});

const analyzeSchema = z.object({
  text: z.string().trim().min(20).max(50000)
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: process.env.AI_PROVIDER || "ollama",
    database: usingPostgres ? "postgres" : "sqlite"
  });
});

app.post("/api/auth/register", authLimiter, async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);
    const email = data.email.toLowerCase();
    const exists = await db.findUserByEmail(email);
    if (exists) return res.status(409).json({ error: "E-mail já cadastrado." });

    const passwordHash = await bcrypt.hash(data.password, 12);
    const created = await db.createUser({ name: data.name, email, passwordHash });

    const user = { id: created.id, name: created.name, email: created.email };
    res.status(201).json({ token: signToken(user), user });
  } catch (e) {
    res.status(400).json({ error: e?.issues?.[0]?.message || "Dados inválidos." });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  try {
    const data = loginSchema.parse(req.body);
    const user = await db.findUserByEmail(data.email.toLowerCase());
    if (!user || !(await bcrypt.compare(data.password, user.password_hash))) {
      return res.status(401).json({ error: "E-mail ou senha inválidos." });
    }

    const safeUser = { id: user.id, name: user.name, email: user.email };
    res.json({ token: signToken(safeUser), user: safeUser });
  } catch {
    res.status(400).json({ error: "Dados inválidos." });
  }
});

app.get("/api/me", requireAuth, async (req, res) => {
  const user = await db.findUserById(req.user.sub);
  if (!user) return res.status(401).json({ error: "Usuário não encontrado." });
  res.json({ user });
});

app.post("/api/attendances/analyze", requireAuth, analyzeLimiter, async (req, res) => {
  try {
    const { text } = analyzeSchema.parse(req.body);
    const parsed = await analisarAtendimento(text);

    const record = await db.createAttendance({
      userId: req.user.sub,
      raw: text,
      identified: parsed.identificado,
      done: parsed.feito,
      category: parsed.categoria,
      summary: parsed.resumo,
      client: parsed.cliente ?? null,
      equipmentJson: JSON.stringify(parsed.equipamentos || [])
    });

    res.status(201).json({
      record: {
        id: record.id,
        raw: record.raw,
        identificado: record.identified,
        feito: record.done,
        categoria: record.category,
        resumo: record.summary,
        cliente: record.client,
        equipamentos: JSON.parse(record.equipment_json),
        date: record.created_at
      }
    });
  } catch (e) {
    console.error(e);
    const message = e?.issues?.[0]?.message || e?.message || "Não foi possível analisar o atendimento.";
    res.status(400).json({ error: message });
  }
});

app.get("/api/attendances", requireAuth, async (req, res) => {
  const rows = await db.listAttendances(req.user.sub, 500);

  res.json({
    records: rows.map(r => ({
      id: r.id,
      raw: r.raw,
      identificado: r.identified,
      feito: r.done,
      categoria: r.category,
      resumo: r.summary,
      cliente: r.client,
      equipamentos: JSON.parse(r.equipment_json),
      date: r.created_at
    }))
  });
});

app.get("/api/attendances/:id/pdf", requireAuth, async (req, res) => {
  const row = await db.getAttendanceById(Number(req.params.id), req.user.sub);

  if (!row) return res.status(404).json({ error: "Atendimento não encontrado." });

  const doc = new PDFDocument({ margin: 50 });
  const filename = `atendimento-${row.id}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  doc.fontSize(20).text("Central Técnica", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(13).text(`Atendimento #${row.id}`);
  doc.fontSize(10).fillColor("#555").text(`Data: ${new Date(row.created_at).toLocaleString("pt-BR")}`);
  doc.fillColor("#000").moveDown();

  doc.fontSize(12).text(`Categoria: ${row.category}`);
  if (row.client) doc.text(`Cliente: ${row.client}`);
  const equipment = JSON.parse(row.equipment_json);
  if (equipment.length) doc.text(`Equipamentos: ${equipment.join(", ")}`);
  doc.moveDown();

  doc.fontSize(14).text(row.summary);
  doc.moveDown();
  doc.fontSize(11).text("O que foi identificado", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10).text(row.identified, { lineGap: 4 });
  doc.moveDown();
  doc.fontSize(11).text("O que foi feito", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10).text(row.done, { lineGap: 4 });

  doc.end();
});

const dist = path.resolve("dist");
if (process.env.NODE_ENV === "production" && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno do servidor." });
});

app.listen(port, () => {
  console.log(`Central Técnica: http://localhost:${port}`);
});
