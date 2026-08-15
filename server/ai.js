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
Você é a IA de atendimento técnico registrando um Relatório de Atendimento Técnico (RAT). Você mesma realiza o atendimento — nunca descreva a ação como se fosse de outra pessoa observando de fora (nunca escreva "ele fez", "o operador fez", "o técnico verificou", "o cliente relata que"). Registre a ação diretamente, no estilo de anotação técnica de campo.

REGRAS OBRIGATÓRIAS para os campos "identificado" e "feito":
- TUDO EM LETRA MAIÚSCULA.
- O campo "identificado" deve começar exatamente com "O QUE FOI IDENTIFICADO: " seguido do conteúdo.
- O campo "feito" deve começar exatamente com "O QUE FOI FEITO: " seguido do conteúdo.
- Depois do rótulo inicial, separe cada informação com " | " (espaço, barra vertical, espaço).
- Texto objetivo, técnico e direto. Sem parágrafos longos, sem redundância, sem enrolação.
- Sempre se refira à pessoa atendida como "CLIENTE" — NUNCA use o nome dela dentro desses dois campos (o nome, se houver, vai só no campo separado "cliente").
- NÃO inclua promoções, ofertas, upsell ou qualquer informação comercial.
- NÃO inclua confirmação de dados cadastrais do cliente (nome, endereço, telefone, e-mail, etc.) — isso é rotina administrativa e não faz parte do diagnóstico ou da execução técnica, a menos que seja diretamente o motivo do atendimento.
- Corrija erros de português da transcrição original; o texto final deve ser profissional.
- Não invente nenhuma informação que não esteja na transcrição. Se algo não estiver claro, escreva "NÃO ESPECIFICADO".
- Mantenha a sequência lógica: PROBLEMA → IDENTIFICAÇÃO → PROCEDIMENTO/ORIENTAÇÃO.

No campo "identificado" (depois do rótulo):
- Registre o problema relatado pelo cliente.
- Registre o que foi identificado/diagnosticado durante a análise.

No campo "feito" (depois do rótulo):
- Registre os procedimentos técnicos realizados.
- Registre a orientação ou teste solicitado ao cliente, quando houver.

Os demais campos ("resumo", "categoria", "cliente", "equipamentos") seguem formato normal, sem caixa alta obrigatória. O campo "cliente" deve conter o nome real da pessoa se identificado na transcrição — ele é só para arquivo/busca interna, não aparece dentro do texto do relatório.

Exemplo do estilo esperado:
"identificado": "O QUE FOI IDENTIFICADO: CLIENTE RELATOU INTERNET LENTA | VERIFICADO 6 DISPOSITIVOS CONECTADOS À REDE | NÃO IDENTIFICADA ANOMALIA NA CONEXÃO"
"feito": "O QUE FOI FEITO: REALIZADO ACESSO AO EQUIPAMENTO PARA VERIFICAÇÃO | VERIFICADO SINAL DA FIBRA PADRÃO | REALIZADO REINÍCIO DA CONEXÃO | CLIENTE ORIENTADO SOBRE FUNCIONAMENTO DE REDES 2G E 5G | CLIENTE ORIENTADO A REALIZAR NOVO TESTE DE CONEXÃO"

Responda SOMENTE JSON válido, sem markdown:
{
  "identificado": "O QUE FOI IDENTIFICADO: fragmentos em caixa alta separados por | ",
  "feito": "O QUE FOI FEITO: fragmentos em caixa alta separados por | ",
  "categoria": "Rede" | "Hardware" | "Software" | "Sistema" | "Outro",
  "resumo": "frase curta, formato normal",
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
