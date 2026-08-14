import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API = "/api";
const categories = ["Rede", "Hardware", "Software", "Sistema", "Outro"];

async function api(path, options = {}) {
  const token = localStorage.getItem("ct_token");
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Ocorreu um erro.");
  return data;
}

function formatDate(value) {
  return new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z"))
    .toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function downloadPdf(id) {
  const token = localStorage.getItem("ct_token");
  const a = document.createElement("a");
  a.href = `${API}/attendances/${id}/pdf?token=${encodeURIComponent(token || "")}`;
  // O backend usa Authorization; abrimos via fetch para não expor token na URL.
  fetch(`${API}/attendances/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } })
    .then(r => r.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = `atendimento-${id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    });
}

async function exportImage(record) {
  // Exportação de imagem sem biblioteca externa: gera SVG e converte para PNG no navegador.
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850">
    <rect width="100%" height="100%" fill="#07090b"/>
    <rect x="40" y="40" width="1120" height="770" rx="24" fill="#0e1115" stroke="#26303a"/>
    <text x="75" y="95" fill="#ffd21c" font-family="Arial" font-size="18">CENTRAL TÉCNICA</text>
    <text x="75" y="135" fill="#ffffff" font-family="Arial" font-size="30" font-weight="700">${escapeXml(record.resumo)}</text>
    <text x="75" y="175" fill="#5ea8ff" font-family="Arial" font-size="16">${escapeXml(record.categoria)} • ${escapeXml(formatDate(record.date))}</text>
    <text x="75" y="230" fill="#ffd21c" font-family="Arial" font-size="15">O QUE FOI IDENTIFICADO</text>
    ${wrapSvg(record.identificado, 75, 265, 1060, 22)}
    <text x="75" y="510" fill="#ffd21c" font-family="Arial" font-size="15">O QUE FOI FEITO</text>
    ${wrapSvg(record.feito, 75, 545, 1060, 22)}
  </svg>`;
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200; canvas.height = 850;
    canvas.getContext("2d").drawImage(img, 0, 0);
    canvas.toBlob(png => {
      const link = document.createElement("a");
      link.download = `atendimento-${record.id}.png`;
      link.href = URL.createObjectURL(png);
      link.click();
    }, "image/png");
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

function escapeXml(s = "") {
  return String(s).replace(/[<>&'"]/g, c => ({ "<":"&lt;", ">":"&gt;", "&":"&amp;", "'":"&apos;", '"':"&quot;" }[c]));
}
function wrapSvg(text, x, y, width, lineHeight) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (test.length > 92) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, 9).map((l, i) =>
    `<text x="${x}" y="${y + i * lineHeight}" fill="#e7ebef" font-family="Arial" font-size="15">${escapeXml(l)}</text>`
  ).join("");
}

function Auth({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const data = await api(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(mode === "login" ? { email, password } : { name, email, password })
      });
      localStorage.setItem("ct_token", data.token);
      onLogin(data.user);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  return <main className="auth-page">
    <section className="auth-card">
      <div className="brand-mark">CT</div>
      <span className="eyebrow">Central técnica</span>
      <h1>{mode === "login" ? "Entrar no painel" : "Criar acesso"}</h1>
      <p className="muted">Relatórios técnicos com IA local, histórico e exportação.</p>
      <form onSubmit={submit} className="form">
        {mode === "register" && <label>Nome<input value={name} onChange={e=>setName(e.target.value)} required /></label>}
        <label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></label>
        <label>Senha<input type="password" minLength="8" value={password} onChange={e=>setPassword(e.target.value)} required /></label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? "Aguarde..." : mode === "login" ? "Entrar" : "Cadastrar"}</button>
      </form>
      <button className="link-btn" onClick={()=>{setMode(mode==="login"?"register":"login");setError("")}}>
        {mode === "login" ? "Ainda não tenho conta" : "Já tenho uma conta"}
      </button>
    </section>
  </main>;
}

function App({ user, logout }) {
  const [input, setInput] = useState("");
  const [records, setRecords] = useState([]);
  const [current, setCurrent] = useState(null);
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState("Todas");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/attendances").then(d=>setRecords(d.records)).catch(e=>setError(e.message));
  }, []);

  const filtered = useMemo(() => records.filter(r => {
    const q = filter.toLowerCase();
    const matchesText = !q || [r.resumo,r.identificado,r.feito,r.cliente,r.categoria].filter(Boolean).some(x=>x.toLowerCase().includes(q));
    return matchesText && (category === "Todas" || r.categoria === category);
  }), [records, filter, category]);

  async function analyze() {
    setError("");
    if (input.trim().length < 20) return setError("Cole um atendimento com pelo menos 20 caracteres.");
    setLoading(true);
    try {
      const d = await api("/attendances/analyze", { method:"POST", body:JSON.stringify({text:input.trim()}) });
      setRecords(prev => [d.record, ...prev]);
      setCurrent(d.record);
      setInput("");
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return <div className="app">
    <header className="topbar">
      <div className="brand"><div className="brand-mark small">CT</div><div><strong>Central Técnica</strong><span>Atendimento & diagnóstico</span></div></div>
      <div className="user-area"><span>{user.name}</span><button className="ghost-btn" onClick={logout}>Sair</button></div>
    </header>

    <main className="content">
      <section className="hero">
        <div><span className="eyebrow">Painel técnico</span><h1>Histórico de atendimento</h1><p className="muted">Cole a transcrição. A IA transforma o atendimento em um relatório profissional e salva no banco.</p></div>
        <div className="status"><i/> IA local • Ollama</div>
      </section>

      <section className="composer card">
        <textarea value={input} onChange={e=>setInput(e.target.value)} placeholder="Cole aqui a transcrição do atendimento..."/>
        <div className="composer-bottom"><span className="counter">{input.length.toLocaleString("pt-BR")} caracteres</span><button className="btn primary" onClick={analyze} disabled={loading}>{loading ? "Analisando..." : "Analisar atendimento"}</button></div>
        {error && <div className="error">{error}</div>}
      </section>

      {current && <section className="report card">
        <div className="report-top"><span className={`badge ${current.categoria.toLowerCase()}`}>{current.categoria}</span><span className="muted">{formatDate(current.date)}</span></div>
        <h2>{current.resumo}</h2>
        <div className="report-grid">
          <div><span className="label">O que foi identificado</span><p>{current.identificado}</p></div>
          <div><span className="label">O que foi feito</span><p>{current.feito}</p></div>
        </div>
        <div className="chips">{current.cliente && <span>Cliente: {current.cliente}</span>}{current.equipamentos?.map((x,i)=><span key={i}>{x}</span>)}</div>
        <div className="actions"><button className="btn secondary" onClick={()=>downloadPdf(current.id)}>Exportar PDF</button><button className="btn secondary" onClick={()=>exportImage(current)}>Exportar PNG</button></div>
      </section>}

      <section className="history">
        <div className="history-head"><div><span className="eyebrow">Arquivo</span><h2>Histórico salvo</h2></div><div className="filters"><input placeholder="Buscar..." value={filter} onChange={e=>setFilter(e.target.value)}/><select value={category} onChange={e=>setCategory(e.target.value)}><option>Todas</option>{categories.map(c=><option key={c}>{c}</option>)}</select></div></div>
        {filtered.length === 0 ? <div className="empty card">Nenhum atendimento encontrado.</div> : <div className="list">{filtered.map(r=><Record key={r.id} r={r} onPdf={()=>downloadPdf(r.id)} onPng={()=>exportImage(r)} />)}</div>}
      </section>
    </main>
  </div>;
}

function Record({r,onPdf,onPng}) {
  const [open,setOpen]=useState(false);
  return <article className="record">
    <button className="record-main" onClick={()=>setOpen(!open)}>
      <span className={`dot ${r.categoria.toLowerCase()}`}></span><div><strong>{r.resumo}</strong><small>{r.categoria} • {formatDate(r.date)}{r.cliente ? ` • ${r.cliente}` : ""}</small></div><span className="chevron">{open?"−":"+"}</span>
    </button>
    {open && <div className="record-body"><div className="report-grid"><div><span className="label">Identificado</span><p>{r.identificado}</p></div><div><span className="label">Feito</span><p>{r.feito}</p></div></div><div className="actions"><button className="btn tiny" onClick={onPdf}>PDF</button><button className="btn tiny" onClick={onPng}>PNG</button></div></div>}
  </article>;
}

function Root() {
  const [user,setUser]=useState(null);
  const [checking,setChecking]=useState(true);
  useEffect(()=>{
    if(!localStorage.getItem("ct_token")) return setChecking(false);
    api("/me").then(d=>setUser(d.user)).catch(()=>localStorage.removeItem("ct_token")).finally(()=>setChecking(false));
  },[]);
  function logout(){localStorage.removeItem("ct_token");setUser(null);}
  if(checking) return <div className="loading-screen">Carregando...</div>;
  return user ? <App user={user} logout={logout}/> : <Auth onLogin={setUser}/>;
}

createRoot(document.getElementById("root")).render(<Root />);
