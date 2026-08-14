import { z } from "zod";

const resultSchema = z.object({
  identificado: z.string().min(1),
  feito: z.string().min(1),
  categoria: z.enum(["Rede", "Hardware", "Software", "Sistema", "Outro"]),
  resumo: z.string().min(1),
  cliente: z.string().nullable().optional(),
  equipamentos: z.array(z.string()).default([])
});

const systemPrompt = `
Você é um técnico de suporte de TI e redes experiente.
Transforme a transcrição de um atendimento em um relatório profissional, natural e factual.
Não invente fatos. Se uma informação não estiver clara, use "Não especificado".
Descreva sintomas/contexto/causa provável em "identificado" e os passos realizados e resultado em "feito".
Responda SOMENTE JSON válido, sem markdown:
{
  "identificado": "3 a 5 frases completas",
  "feito": "3 a 5 frases completas",
  "categoria": "Rede" | "Hardware" | "Software" | "Sistema" | "Outro",
  "resumo": "frase curta",
  "cliente": "nome ou null",
  "equipamentos": ["..."]
}
`;

function parseModelJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("A IA não retornou JSON válido.");
  return resultSchema.parse(JSON.parse(cleaned.slice(start, end + 1)));
}

async function callOllama(input) {
  const base = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.2:3b";

  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input }
      ],
      options: { temperature: 0.2 }
    })
  });

  if (!response.ok) throw new Error(`Ollama respondeu HTTP ${response.status}.`);
  const data = await response.json();
  return parseModelJson(data?.message?.content || "");
}

async function callOpenAICompatible(input) {
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;

  if (!key || !model) {
    throw new Error("OPENAI_API_KEY e OPENAI_MODEL precisam estar configurados.");
  }

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input }
      ]
    })
  });

  if (!response.ok) throw new Error(`Provedor de IA respondeu HTTP ${response.status}.`);
  const data = await response.json();
  return parseModelJson(data?.choices?.[0]?.message?.content || "");
}

export async function analisarAtendimento(input) {
  const provider = (process.env.AI_PROVIDER || "ollama").toLowerCase();
  if (provider === "openai-compatible") return callOpenAICompatible(input);
  return callOllama(input);
}
