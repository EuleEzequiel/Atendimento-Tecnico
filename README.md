# Central Técnica

Aplicação completa para transformar transcrições de atendimentos de TI em relatórios técnicos, com:

- Login e cadastro.
- Banco de dados com troca automática: SQLite localmente, Postgres em produção (basta definir `DATABASE_URL`).
- IA local com Ollama para desenvolvimento, sem cobrança de API e sem limite imposto por fornecedor.
- Suporte pronto para provedor de IA hospedado compatível com OpenAI (Groq, OpenRouter, Together, DeepSeek, OpenAI etc.) para produção.
- Histórico pesquisável e filtrável.
- Exportação para PDF.
- Exportação para PNG.
- Rate limit, Helmet, CORS, validação com Zod, bcrypt e JWT.
- Interface dark em preto, amarelo, azul e branco.

## 1. Requisitos

- Node.js 20+
- npm
- Para IA local: Ollama instalado e um modelo local disponível.

## 2. Instalação

```bash
npm install
cp .env.example .env
```

No Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edite `.env` e troque `JWT_SECRET` por uma string aleatória com pelo menos 32 caracteres.

## 3. IA grátis/local

Instale o Ollama e baixe um modelo:

```bash
ollama pull llama3.2:3b
```

Depois:

```bash
npm run dev
```

Abra:

http://localhost:5173

O backend usa `http://127.0.0.1:11434` e o modelo `llama3.2:3b` por padrão.

### Importante sobre "grátis e ilimitado"

Nenhuma API hospedada de IA pode ser prometida como gratuita e ilimitada. O projeto evita esse problema usando Ollama local: você executa o modelo na sua própria máquina, então não há cobrança por requisição nem quota de API. O limite real passa a ser CPU/GPU, RAM, armazenamento e velocidade da sua máquina.

## 4. Usar outro provedor

O backend aceita um endpoint OpenAI-compatible:

```env
AI_PROVIDER=openai-compatible
OPENAI_BASE_URL=https://seu-endpoint/v1
OPENAI_API_KEY=sua-chave
OPENAI_MODEL=seu-modelo
```

A chave fica exclusivamente no servidor.

## 5. Produção

```bash
npm run build
NODE_ENV=production npm start
```

O Express servirá o `dist/`.

Em produção, coloque o sistema atrás de HTTPS e defina:

- `JWT_SECRET` forte.
- `CORS_ORIGIN` para o domínio real.
- `DB_PATH` em volume persistente.
- Backup periódico do arquivo SQLite.

## 6. Segurança

Correções em relação ao código original:

1. A chave/API de IA não fica no navegador.
2. O navegador não chama diretamente o fornecedor de IA.
3. `window.storage` foi substituído por SQLite no servidor.
4. Senhas são armazenadas com bcrypt.
5. Rotas privadas exigem JWT.
6. Há rate limit em login/cadastro/análise.
7. Helmet adiciona cabeçalhos de segurança.
8. CORS é restrito ao frontend configurado.
9. Entradas são validadas e possuem limites de tamanho.
10. Cada atendimento é associado ao usuário autenticado.
11. PDFs só podem ser baixados pelo dono do atendimento.
12. O servidor não aceita HTML/JS como conteúdo de interface; o React renderiza os dados.
13. A resposta da IA é validada com Zod antes de ser gravada.

## 7. Melhorias importantes para ambiente empresarial

Para uso em internet pública, recomendo adicionar:

- HTTPS com proxy reverso (Nginx/Caddy).
- Cookies HttpOnly/Secure/SameSite em vez de guardar JWT no localStorage.
- Recuperação de senha por e-mail.
- MFA.
- Auditoria de ações.
- Backup criptografado.
- PostgreSQL em vez de SQLite se houver muitos usuários/conexões.
- Antivírus/controle de upload caso sejam adicionados anexos.
- Política de retenção e LGPD para transcrições.

## 8. Observação sobre o código original

O projeto original tinha um problema crítico de arquitetura: tentava consultar o serviço de IA diretamente no navegador. Além de não possuir uma forma segura de guardar uma chave, também dependia de `window.storage`, que não é uma persistência web padrão. Nesta versão, IA, banco e regras de segurança ficam no backend.


## 9. Publicação gratuita

### Opção recomendada para teste: Render

O projeto inclui `render.yaml` para facilitar a publicação como Web Service.

Fluxo:

1. Crie um repositório no GitHub e envie esta pasta.
2. No Render, crie um Web Service conectado ao repositório.
3. Escolha o plano Free.
4. Configure as variáveis:
   - `CORS_ORIGIN` = URL pública do serviço.
   - `AI_PROVIDER=openai-compatible`.
   - `OPENAI_BASE_URL`, `OPENAI_API_KEY` e `OPENAI_MODEL` de um provedor compatível.
   - `DATABASE_URL` se estiver usando PostgreSQL.
5. Faça o deploy.

**Atenção:** o SQLite local não deve ser usado como banco persistente em hospedagem gratuita com filesystem efêmero. No Render, alterações no filesystem local podem ser perdidas quando o serviço reinicia, sofre redeploy ou entra em sleep. Para dados persistentes, use PostgreSQL externo. O Postgres gratuito do próprio Render expira após 30 dias, então não é uma boa opção para guardar dados permanentes.

**Isso já está resolvido no código:** o servidor detecta automaticamente a variável `DATABASE_URL`. Se ela existir, usa Postgres (com SSL) e cria as tabelas automaticamente na primeira execução. Se não existir, cai para SQLite local. Basta configurar `DATABASE_URL` no Render (ou em qualquer ambiente) apontando para um Postgres externo — veja a opção Supabase abaixo — que os dados passam a persistir entre deploys e reinícios.

### IA hospedada na hospedagem (obrigatório para produção)

O Ollama local não pode simplesmente ser transferido para um Web Service gratuito comum como se fosse o mesmo ambiente do seu computador — o Render Free não roda um servidor de IA de fundo nem tem GPU. Para o site funcionar publicamente, é obrigatório usar `AI_PROVIDER=openai-compatible` com um endpoint hospedado (é assim que o `render.yaml` já vem configurado por padrão).

A chave nunca fica no frontend: o navegador chama sempre `/api/attendances/analyze` no seu próprio backend, e é o backend (servidor Node) quem guarda `OPENAI_API_KEY` e chama o provedor de IA.

Opções de provedor compatíveis com a API da OpenAI (formato `/chat/completions`), da mais barata/gratuita para a mais conhecida:

| Provedor | `OPENAI_BASE_URL` | Observação |
|---|---|---|
| [Groq](https://console.groq.com) | `https://api.groq.com/openai/v1` | Tier gratuito generoso, modelos rápidos (ex: `llama-3.3-70b-versatile`). Boa opção para testar sem custo. |
| [OpenRouter](https://openrouter.ai) | `https://openrouter.ai/api/v1` | Dá acesso a vários modelos, alguns gratuitos (ex: `meta-llama/llama-3.3-70b-instruct:free`). |
| [Together AI](https://together.ai) | `https://api.together.xyz/v1` | Crédito inicial gratuito, depois pago por uso. |
| [DeepSeek](https://platform.deepseek.com) | `https://api.deepseek.com/v1` | Pago, mas muito barato por token. |
| [OpenAI](https://platform.openai.com) | `https://api.openai.com/v1` | Pago, sem tier gratuito permanente. |

Configuração no Render (Environment):

```
AI_PROVIDER=openai-compatible
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_API_KEY=sua-chave-do-groq
OPENAI_MODEL=llama-3.3-70b-versatile
```

Depois de configurar, use `GET /api/health` para conferir rapidamente se o serviço está de pé e qual provedor/banco estão ativos (a rota responde `{ ok: true, provider: "...", database: "postgres" | "sqlite" }`).

### Banco de dados persistente: Supabase (recomendado)

O Supabase possui PostgreSQL no plano Free, com 500 MB de banco e 1 GB de armazenamento de arquivos. Projetos gratuitos podem ser pausados após uma semana de inatividade (basta reativar no painel). Para este projeto, Supabase é a alternativa recomendada para dados persistentes.

Como configurar:

1. Crie uma conta em [supabase.com](https://supabase.com) e crie um novo projeto (plano Free).
2. No painel do projeto, vá em **Project Settings > Database > Connection string** e copie a URI no modo **Session pooler** (formato `postgresql://postgres.xxxx:senha@aws-x-...pooler.supabase.com:5432/postgres`). O pooler é recomendado porque o Render Free e outros ambientes serverless costumam ter IPv4 limitado.
3. No Render, defina a variável `DATABASE_URL` do Web Service com essa string de conexão (troque `senha` pela senha do banco definida na criação do projeto).
4. Não é preciso rodar nenhuma migração manual: ao iniciar, o servidor cria as tabelas `users` e `attendances` automaticamente caso ainda não existam.
5. Redeploys, reinícios e o modo sleep do Render Free deixam de apagar os dados, porque eles passam a viver no Postgres do Supabase, não no disco do Web Service.

Outras opções de Postgres gratuito compatíveis (mesma variável `DATABASE_URL`): [Neon](https://neon.tech) e o Postgres gratuito do próprio Render (lembrando que este último expira em 30 dias).

### Limitação real do "gratuito"

Hospedagem gratuita não significa disponibilidade ilimitada. Por exemplo, o Render Free coloca Web Services em sleep após 15 minutos sem tráfego e possui limites mensais de uso. Isso é adequado para testes, portfólio e uso pessoal leve, mas não deve ser tratado como infraestrutura de produção.
