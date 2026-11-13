const SUPABASE_URL = 'https://jsvkqqnifemahspcebhf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tR25PVC5_p_TZWxQy7TMtw_1-ScKd6S';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = s => document.querySelector(s);
const brl = v => Number(v || 0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const ini = () => $('#de').value;
// fim é exclusivo (dia seguinte ao "Até"), para usar com .lt()
const fim = () => { const d = new Date($('#ate').value + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const br = d => d.split('-').reverse().join('/');
const anoIni = () => { const [y, m] = ini().split('-').map(Number); return m >= 9 ? y : y - 1; };
const ano = () => anoIni() + '/' + (anoIni() + 1);
const iniAno = () => anoIni() + '-09-01';
const fimAno = () => (anoIni() + 1) + '-09-01';
// Trimestre do ano rural que contém a data "De" (Set-Nov, Dez-Fev, Mar-Mai, Jun-Ago)
const MESES_ABR = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
function trimestre() {
  const m = +ini().split('-')[1];
  const q = Math.floor(((m + 3) % 12) / 3);          // 0..3 (set = 0)
  const a = anoIni();
  const s = new Date(Date.UTC(a, 8 + q * 3, 1));
  const e = new Date(Date.UTC(a, 8 + q * 3 + 3, 1)); // exclusivo
  const ult = new Date(Date.UTC(a, 8 + q * 3 + 2, 1));
  return {
    ini: s.toISOString().slice(0, 10),
    fim: e.toISOString().slice(0, 10),
    nome: `${q + 1}º tri (${MESES_ABR[s.getUTCMonth()]}-${MESES_ABR[ult.getUTCMonth()]})`
  };
}
let TRI = { P: {}, R: {}, nome: '' };   // previsto/realizado do trimestre por categoria
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function preset(v) {
  const t = new Date(), y = t.getFullYear(), m = t.getMonth();
  let a, b;
  if (v === 'mes') { a = new Date(y, m, 1); b = new Date(y, m + 1, 0); }
  else if (v === 'ant') { a = new Date(y, m - 1, 1); b = new Date(y, m, 0); }
  else if (v === '30') { b = t; a = new Date(y, m, t.getDate() - 29); }
  else if (v === 'ano') { const s = m >= 8 ? y : y - 1; a = new Date(s, 8, 1); b = new Date(s + 1, 7, 31); }
  else return;
  $('#de').value = iso(a); $('#ate').value = iso(b);
}
// busca todas as linhas (passa de 1000)
async function todos(q) {
  let all = [], from = 0;
  while (true) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}
let cats = [], tab = 'painel', agr = 'secao', busca = '', tBusca, catSel = '';
const LIMITE_ALERTA = 80; // % do previsto a partir do qual aparece o aviso
// Ordem das seções no Painel (edite como quiser). Seções fora da lista vão para o fim.
const ORDEM_SECOES = [
  'Receita',
  'Fixos',
  'Variáveis Operacional',
  'Variáveis Formação / Manut Pastos',
  'Variáveis Nutrição Animal',
  'Variáveis Sanidade Animal',
  'Banco',
  'Investimentos',
  'Soja',
  'Emprestimos'
];
const posSecao = s => { const i = ORDEM_SECOES.findIndex(o => norm(o) === norm(s)); return i < 0 ? 999 : i; };
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const ehTransf = c => !!c && norm(c.natureza).startsWith('transfer');
const casaCat = c => !busca.trim() || norm(c.nome).includes(norm(busca.trim()));
const casaLanc = (x, nomeCat) => !busca.trim() || norm(nomeCat).includes(norm(busca.trim())) || norm(x.descricao).includes(norm(busca.trim()));
const campoBusca = () => `<input id="busca" type="search" placeholder="${tab === 'realizado' ? 'Pesquisar categoria ou descrição...' : 'Pesquisar categoria...'}" value="${esc(busca)}" oninput="buscar(this.value)" style="min-width:220px" aria-label="Pesquisar categoria">`;
function buscar(v) {
  busca = v;
  clearTimeout(tBusca);
  tBusca = setTimeout(async () => {
    await (tab === 'painel' ? vPainel() : vRealizado());
    const i = $('#busca');
    if (i) { i.focus(); i.setSelectionRange(v.length, v.length); }
  }, 250);
}

// Pesquisa simples das abas Previsto e Plano de contas: só esconde linhas
const campoFiltro = () => `<input type="search" placeholder="Pesquisar categoria..." oninput="filtrarLinhas(this.value)" style="min-width:220px" aria-label="Pesquisar categoria">`;
function filtrarLinhas(v) {
  const q = norm(v.trim());
  document.querySelectorAll('#view tr[data-busca]').forEach(tr => {
    tr.hidden = !!q && !tr.dataset.busca.includes(q);
  });
}

let perm = { admin: false, editar: false, abas: [] }, meuId = null;
const pode = a => perm.admin || (a !== 'usuarios' && perm.abas.includes(a));
const podeEditar = () => perm.admin || perm.editar;
function aplicarPermissoes() {
  const btns = [...document.querySelectorAll('#tabs button')];
  btns.forEach(b => b.hidden = !pode(b.dataset.t));
  const primeira = btns.find(b => !b.hidden);
  if (!primeira) { alert('Seu usuário não tem nenhuma aba liberada.'); return false; }
  tab = primeira.dataset.t;
  btns.forEach(x => x.classList.toggle('on', x === primeira));
  document.body.classList.toggle('sem-editar', !podeEditar());
  document.body.classList.toggle('sem-admin', !perm.admin);
  $('#bk').hidden = !perm.admin;
  return true;
}
async function init() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { document.body.classList.add('entrando'); $('#login').hidden = false; return; }
  const { data: pm, error } = await db.from('permissoes').select('*').eq('user_id', session.user.id).maybeSingle();
  if (error) return alert('Erro ao carregar permissões: ' + error.message);
  if (!pm) { alert('Seu usuário ainda não tem acesso. Peça ao administrador para liberar.'); await db.auth.signOut(); return location.reload(); }
  perm = { admin: !!pm.admin, editar: !!pm.editar, abas: pm.abas || [] };
  meuId = session.user.id;
  if (!aplicarPermissoes()) { await db.auth.signOut(); return location.reload(); }
  $('#app').hidden = false;
  preset('mes');
  render();
}
$('#entrar').onclick = async () => {
  const { error } = await db.auth.signInWithPassword({ email: $('#em').value, password: $('#pw').value });
  error ? alert('Não foi possível entrar: ' + error.message) : location.reload();
};
$('#sair').onclick = async () => { await db.auth.signOut(); location.reload(); };
$('#pre').onchange = e => { preset(e.target.value); render(); };
['#de', '#ate'].forEach(s => $(s).onchange = () => {
  $('#pre').value = 'custom';
  if ($('#de').value && $('#ate').value && $('#de').value > $('#ate').value) {
    [$('#de').value, $('#ate').value] = [$('#ate').value, $('#de').value];
  }
  render();
});
$('#tabs').onclick = e => {
  const b = e.target.closest('button[data-t]');
  if (!b) return;
  tab = b.dataset.t;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  render();
};

async function render() {
  if (!$('#de').value || !$('#ate').value) return;
  const [rc, rb] = await Promise.all([
    db.from('categorias').select('*').order('tipo').order('nome'),
    db.from('contas_bancarias').select('*').order('nome')
  ]);
  if (rc.error) return alert(rc.error.message);
  if (rb.error) return alert(rb.error.message);
  cats = rc.data; contas = rb.data;
  ({ painel: vPainel, realizado: vRealizado, previsto: vPrevisto, categorias: vCategorias, relatorios: vRelatorios, resultados: vResultados, usuarios: vUsuarios })[tab]();
}

function itemPainel(nome, a, b, t, m, ids, tot) {
  // a = previsto do ano | b = realizado no ano | m = realizado no período
  const s = t === 'despesa' ? a - b : b - a;
  const pc = a > 0 ? b / a * 100 : 0;
  const over = t === 'despesa' && b > a;
  // trimestre
  const soma = o => ids.reduce((acc, i) => acc + (o[i] || 0), 0);
  const tp = soma(TRI.P), tr = soma(TRI.R);
  const st = t === 'despesa' ? tp - tr : tr - tp;
  return `<details class="pi${tot ? ' tot' : ''}"><summary><span class="pn">${nome}</span>
      <span class="bar"><i class="${over ? 'over' : ''}" style="width:${Math.min(pc, 100)}%"></i></span><span class="pp${over ? ' neg' : ''}">${pc.toFixed(0)}%</span></summary>
    <div class="pd">
      <div><small>Realizado no período</small><b>${brl(m)}</b></div>
      <div><small>Previsto (${TRI.nome})</small><b>${brl(tp)}</b></div>
      <div><small>Realizado (${TRI.nome})</small><b>${brl(tr)}</b></div>
      <div><small>Saldo do trimestre</small><b class="${st < 0 ? 'neg' : ''}">${brl(st)}</b></div>
      <div><small>Previsto (ano)</small><b>${brl(a)}</b></div>
      <div><small>Realizado no ano</small><b>${brl(b)}</b></div>
      <div><small>Saldo do ano</small><b class="${s < 0 ? 'neg' : ''}">${brl(s)}</b></div>
      <button class="p" data-ids="${ids.join(',')}" data-nome="${nome}">Ver lançamentos</button>
    </div></details>`;
}

async function vPainel() {
  $('#view').className = '';
  const [p, r, rp] = await Promise.all([
    db.from('previsto').select('categoria_id,valor').gte('mes', iniAno()).lt('mes', fimAno()),
    db.from('realizado_mensal').select('categoria_id,mes,total').gte('mes', iniAno()).lt('mes', fimAno()),
    todos(() => db.from('realizado').select('categoria_id,valor').gte('data', ini()).lt('data', fim()).order('id'))
  ]);
  if (p.error) return alert(p.error.message);
  if (r.error) return alert(r.error.message);
  const P = {}, R = {}, M = {};
  p.data.forEach(x => P[x.categoria_id] = (P[x.categoria_id] || 0) + +x.valor);
  r.data.forEach(x => R[x.categoria_id] = (R[x.categoria_id] || 0) + +x.total);
  rp.forEach(x => M[x.categoria_id] = (M[x.categoria_id] || 0) + +x.valor);
  // trimestre: previsto = anual / 4 | realizado = soma dos meses do trimestre
  const tri = trimestre();
  TRI = { P: {}, R: {}, nome: tri.nome };
  Object.keys(P).forEach(k => TRI.P[k] = P[k] / 4);
  r.data.filter(x => x.mes >= tri.ini && x.mes < tri.fim)
    .forEach(x => TRI.R[x.categoria_id] = (TRI.R[x.categoria_id] || 0) + +x.total);
  const sel = v => agr === v ? ' selected' : '';
  let h = alertas(P, R) + `<div class="row"><select onchange="agr=this.value;vPainel()" aria-label="Agrupamento">
    <option value="secao"${sel('secao')}>Por seção (modelo planilha)</option>
    <option value="nome"${sel('nome')}>Agrupar por categoria</option>
    <option value="natureza"${sel('natureza')}>Agrupar por natureza</option>
    <option value="subgrupo"${sel('subgrupo')}>Agrupar por subgrupo</option></select>
    ${campoBusca()}
    <span class="periodo">Ano rural ${ano()} (set a ago) • Período: ${br(ini())} a ${br($('#ate').value)}</span></div>`;

  for (const t of ['receita', 'despesa']) {
    const lista = cats.filter(c => c.tipo === t && c.ativo && !ehTransf(c) && casaCat(c));
    if (!lista.length) continue;
    let rows = '', tp = 0, tr = 0, tm = 0;

    if (agr === 'secao') {
      const S = {};
      lista.forEach(c => { (S[c.subgrupo || '(sem seção)'] ||= []).push(c); });
      Object.entries(S).sort((a, b) => posSecao(a[0]) - posSecao(b[0])).forEach(([sec, cs]) => {
        let sp = 0, sr = 0, sm = 0, itens = '';
        cs.forEach(c => {
          const a = P[c.id] || 0, b = R[c.id] || 0, m = M[c.id] || 0;
          sp += a; sr += b; sm += m;
          itens += itemPainel(esc(c.nome), a, b, t, m, [c.id]);
        });
        tp += sp; tr += sr; tm += sm;
        rows += `<details class="ps" open><summary><span class="pn">${esc(sec)}</span><span class="pv">${brl(sr)} de ${brl(sp)}</span></summary>${itens}</details>`;
      });
    } else {
      const G = {};
      lista.forEach(c => {
        const k = c[agr] || '(não informado)';
        G[k] = G[k] || [0, 0, 0, []];
        G[k][0] += P[c.id] || 0; G[k][1] += R[c.id] || 0; G[k][2] += M[c.id] || 0;
        G[k][3].push(c.id);
      });
      Object.entries(G).forEach(([k, [a, b, m, ids]]) => { tp += a; tr += b; tm += m; rows += itemPainel(esc(k), a, b, t, m, ids); });
    }
    rows = itemPainel(agr === 'secao' ? 'TOTAL GERAL' : 'Total', tp, tr, t, tm, lista.map(c => c.id), true) + rows;
    h += bloco(t, `<div class="pl">${rows}</div>`, tp, tr);
  }
  $('#view').innerHTML = !cats.some(c => c.ativo)
    ? '<p class="empty">Cadastre as contas na aba Plano de contas para começar.</p>'
    : h.includes('class="bloco"') ? h : h + '<p class="empty">Nenhuma categoria encontrada.</p>';
}


/* ---------- Painel ---------- */
async function vPainelAntigo() {
  $('#view').className = '';
  const [p, r, rp] = await Promise.all([
    db.from('previsto').select('categoria_id,valor').gte('mes', iniAno()).lt('mes', fimAno()),
    db.from('realizado_mensal').select('categoria_id,mes,total').gte('mes', iniAno()).lt('mes', fimAno()),
    todos(() => db.from('realizado').select('categoria_id,valor').gte('data', ini()).lt('data', fim()).order('id'))
  ]);
  const P = {}, R = {}, M = {};
  p.data.forEach(x => P[x.categoria_id] = (P[x.categoria_id] || 0) + +x.valor);
  r.data.forEach(x => R[x.categoria_id] = (R[x.categoria_id] || 0) + +x.total);
  rp.forEach(x => M[x.categoria_id] = (M[x.categoria_id] || 0) + +x.valor);
  const sel = v => agr === v ? ' selected' : '';
  let h = alertas(P, R) + `<div class="row"><select onchange="agr=this.value;vPainel()" aria-label="Agrupamento">
    <option value="secao"${sel('secao')}>Por seção (modelo planilha)</option>
    <option value="nome"${sel('nome')}>Agrupar por categoria</option>
    <option value="natureza"${sel('natureza')}>Agrupar por natureza</option>
    <option value="subgrupo"${sel('subgrupo')}>Agrupar por subgrupo</option></select>
    ${campoBusca()}
    <span class="periodo">Ano rural ${ano()} (set a ago) • Período: ${br(ini())} a ${br($('#ate').value)}</span></div>`;

  const cab = n => `<tr><th>${n}</th><th>Previsto (ano)</th><th>Realizado no período</th><th>Realizado no ano</th><th>Saldo do ano</th><th>Execução</th></tr>`;

  for (const t of ['receita', 'despesa']) {
    const lista = cats.filter(c => c.tipo === t && c.ativo && !ehTransf(c) && casaCat(c));
    if (!lista.length) continue;
    let rows = '', tp = 0, tr = 0, tm = 0, cabNome = 'Categoria / Item';

    if (agr === 'secao') {
      const S = {};
      lista.forEach(c => { (S[c.subgrupo || '(sem seção)'] ||= []).push(c); });
      Object.entries(S).sort((a, b) => posSecao(a[0]) - posSecao(b[0])).forEach(([sec, cs]) => {
        let sp = 0, sr = 0, sm = 0;
        rows += `<tr class="sec"><td colspan="6">${esc(sec)}</td></tr>`;
        cs.forEach(c => {
          const a = P[c.id] || 0, b = R[c.id] || 0, m = M[c.id] || 0;
          sp += a; sr += b; sm += m;
          rows += linha(esc(c.nome), a, b, t, false, m, [c.id]).replace('<tr class=""', '<tr class="it"');
        });
        tp += sp; tr += sr; tm += sm;
        rows += linha('TOTAL ' + esc(sec), sp, sr, t, true, sm, cs.map(c => c.id)).replace('class="tot"', 'class="sub"')
              + '<tr class="spc"><td colspan="6"></td></tr>';
      });
    } else {
      const G = {};
      lista.forEach(c => {
        const k = c[agr] || '(não informado)';
        G[k] = G[k] || [0, 0, 0, []];
        G[k][0] += P[c.id] || 0; G[k][1] += R[c.id] || 0; G[k][2] += M[c.id] || 0;
        G[k][3].push(c.id);
      });
      Object.entries(G).forEach(([k, [a, b, m, ids]]) => { tp += a; tr += b; tm += m; rows += linha(esc(k), a, b, t, false, m, ids); });
      cabNome = agr === 'nome' ? 'Categoria' : agr === 'natureza' ? 'Natureza' : 'Subgrupo';
    }
    rows += linha(agr === 'secao' ? 'TOTAL GERAL' : 'Total', tp, tr, t, true, tm, lista.map(c => c.id));    h += bloco(t, `<table>${cab(cabNome)}${rows}</table>`, tp, tr);
  }
  $('#view').innerHTML = !cats.some(c => c.ativo)
    ? '<p class="empty">Cadastre as contas na aba Plano de contas para começar.</p>'
    : h.includes('class="bloco"') ? h : h + '<p class="empty">Nenhuma categoria encontrada.</p>';
}

function bloco(t, tabela, tp, tr) {
  const rec = t === 'receita';
  const pc = tp > 0 ? tr / tp * 100 : 0;
  const cor = rec ? (pc >= 100 ? 'var(--pri)' : 'var(--acc)') : (pc >= 100 ? 'var(--bad)' : 'var(--pri)');
  const txt = rec ? (pc >= 100 ? 'Receitas acima do previsto!' : 'Receitas abaixo do previsto')
                  : (pc >= 100 ? 'Despesas acima do previsto!' : 'Despesas dentro do planejado');
  const C = 2 * Math.PI * 52, d = Math.min(pc, 100) / 100 * C;
  const sinal = rec ? '<span class="sinal">$</span>'
    : '<svg class="ic sinal d" viewBox="0 0 24 24" style="width:30px;height:30px;padding:3px"><path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7V6a2 2 0 0 1 2-2h11M16 14h2"/></svg>';
  return `<section class="bloco">
    <div class="card"><h3>${sinal}${rec ? 'Receitas' : 'Despesas'}</h3><div class="scroll">${tabela}</div></div>
    <div class="card meta">
      <svg viewBox="0 0 120 120" role="img" aria-label="${pc.toFixed(0)}% da meta">
        <circle cx="60" cy="60" r="52" fill="none" stroke="#1b2b22" stroke-width="10"/>
        <circle cx="60" cy="60" r="52" fill="none" stroke="${cor}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${d} ${C}" transform="rotate(-90 60 60)"/>
        <text x="60" y="62" text-anchor="middle" class="pc">${pc.toFixed(0)}%</text>
        <text x="60" y="80" text-anchor="middle" class="sm">da meta</text>
      </svg>
      <p style="color:${cor}">${txt}</p>
    </div></section>`;
}

function linha(nome, a, b, t, tot, m, ids) {
  // ids = categorias que esta linha representa (para o detalhe ao clicar)
  const s = t === 'despesa' ? a - b : b - a;
  const pc = a > 0 ? b / a * 100 : 0;
  const over = t === 'despesa' && b > a;
  const at = ids && ids.length ? ` data-ids="${ids.join(',')}" data-nome="${nome}"` : '';
  return `<tr class="${tot ? 'tot' : ''}"${at}><td>${nome}</td><td>${brl(a)}</td><td>${brl(m)}</td><td>${brl(b)}</td>
    <td class="${s < 0 ? 'neg' : ''}">${brl(s)}</td>
    <td><span class="bar"><i class="${over ? 'over' : ''}" style="width:${Math.min(pc, 100)}%"></i></span>${pc.toFixed(0)}%</td></tr>`;
}

function alertas(P, R) {
  const est = [], per = [];
  cats.filter(c => c.tipo === 'despesa' && c.ativo && (P[c.id] || 0) > 0).forEach(c => {
    const pc = (R[c.id] || 0) / P[c.id] * 100;
    const item = `<li><b>${esc(c.nome)}</b>: ${pc.toFixed(0)}% do previsto (${brl(R[c.id] || 0)} de ${brl(P[c.id])})</li>`;
    if (pc >= 100) est.push(item); else if (pc >= LIMITE_ALERTA) per.push(item);
  });
  return (est.length ? `<details class="alerta" role="alert"><summary>⚠ Previsto estourado em ${est.length} conta(s)</summary><ul>${est.join('')}</ul></details>` : '')
    + (per.length ? `<details class="alerta aviso" role="alert"><summary>Atenção: perto do previsto (${LIMITE_ALERTA}% ou mais): ${per.length} conta(s)</summary><ul>${per.join('')}</ul></details>` : '');
}

async function checarAlerta(catId, data) {
  const [y, m] = data.split('-').map(Number), a = m >= 9 ? y : y - 1;
  const de = a + '-09-01', ate = (a + 1) + '-09-01';
  const [p, r] = await Promise.all([
    db.from('previsto').select('valor').eq('categoria_id', catId).gte('mes', de).lt('mes', ate),
    db.from('realizado_mensal').select('total').eq('categoria_id', catId).gte('mes', de).lt('mes', ate)
  ]);
  const prev = p.data.reduce((s, x) => s + +x.valor, 0), real = r.data.reduce((s, x) => s + +x.total, 0);
  const c = cats.find(x => x.id === catId);
  if (!c || c.tipo !== 'despesa' || !prev) return;
  const pc = real / prev * 100, txt = `${c.nome}: ${brl(real)} de ${brl(prev)} previstos (${pc.toFixed(0)}%) no ano rural ${a}/${a + 1}.`;
  if (pc >= 100) alert('🚨 PREVISTO ESTOURADO!\n\n' + txt);
  else if (pc >= LIMITE_ALERTA) alert('⚠ ATENÇÃO: perto do previsto\n\n' + txt);
}

/* ---------- Realizado ---------- */
let editId = null, lancs = [], contas = [], contaSel = 'sep', editContaId = null;
async function vRealizado() {
  const T = Object.fromEntries(cats.map(c => [c.id, c.tipo]));
  const N = Object.fromEntries(cats.map(c => [c.id, c.nome]));
  const CB = Object.fromEntries(contas.map(c => [c.id, c.nome]));
  const de = ini(), ate = fim();
  const sg = x => (T[x.categoria_id] === 'receita' ? 1 : -1) * +x.valor;
  const soma = o => Object.values(o).reduce((a, b) => a + b, 0);
  const neg = v => v < 0 ? ' class="neg"' : '';
  const cartao = (t, v) => `<div class="card" style="padding:14px 18px;min-width:190px"><small style="color:var(--mut)">${t}</small><div style="font-size:20px;font-weight:700"${neg(v)}>${brl(v)}</div></div>`;
  const sub = t => `<p style="color:var(--mut);margin:18px 0 6px;font-weight:600">${t}</p>`;

  // tudo até o fim do período (precisa do histórico para o saldo de abertura)
  const todosLanc = await todos(() => {
    let s = db.from('realizado').select('*').lt('data', ate);
    if (contaSel && contaSel !== 'sep') s = s.eq('conta_id', +contaSel);
    return s.order('data').order('id');
  });

  lancs = [];

  // monta o relatório de um conjunto de contas
  const relConta = (escopo, titulo) => {
    const ids = new Set(escopo.map(c => c.id));
    const cur = {};
    escopo.forEach(c => cur[c.id] = +c.saldo_inicial);
    const periodo = [];
    todosLanc.filter(x => ids.has(x.conta_id)).forEach(x => {
      if (x.data < de) cur[x.conta_id] = (cur[x.conta_id] || 0) + sg(x);
      else periodo.push(x);
    });
    const abertura = soma(cur), porConta = escopo.length > 1;

    // saldo dia a dia (só dias com movimento) e saldo após cada lançamento
    const dias = [];
    let i = 0;
    while (i < periodo.length) {
      const d = periodo[i].data; let e = 0, s = 0;
      while (i < periodo.length && periodo[i].data === d) {
        const x = periodo[i++], v = sg(x);
        cur[x.conta_id] = (cur[x.conta_id] || 0) + v;
        x.sc = cur[x.conta_id]; x.st = soma(cur);
        v >= 0 ? e += v : s -= v;
      }
      dias.push({ d, e, s, por: { ...cur }, tot: soma(cur) });
    }

    // lista (respeita busca e categoria; os saldos não mudam com elas)
    const data = periodo.filter(x => casaLanc(x, N[x.categoria_id]) && (!catSel || x.categoria_id === +catSel));
    lancs.push(...data);

    const totRec = data.filter(x => T[x.categoria_id] === 'receita').reduce((s, x) => s + +x.valor, 0);
    const totDes = data.filter(x => T[x.categoria_id] !== 'receita').reduce((s, x) => s + +x.valor, 0);
    const saldoFinal = abertura + totRec - totDes;

    const cards = escopo.map(c => cartao(esc(c.nome), cur[c.id])).join('') + (porConta ? cartao('Saldo total', soma(cur)) : '');


    return `<section style="margin-bottom:34px">
      ${titulo ? `<h3 style="font-size:20px;color:var(--pri)">${esc(titulo)}</h3>` : ''}
      <div class="row">${cards}</div>
      ${sub('Lançamentos')}
      <div class="scroll"><table><tr><th>Data</th><th style="text-align:left">Conta</th><th style="text-align:left">Categoria</th><th style="text-align:left">Descrição</th><th>Receita</th><th>Despesa</th><th>Saldo${porConta ? ' da conta' : ''}</th>${porConta ? '<th>Saldo total</th>' : ''}<th></th></tr>
      <tr class="sub"><td>${br(de)}</td><td style="text-align:left">${porConta ? 'Todas' : esc(escopo[0] ? escopo[0].nome : '')}</td>
        <td colspan="2" style="text-align:left">Saldo anterior</td>
        <td></td><td></td><td${neg(abertura)}><b>${brl(abertura)}</b></td>${porConta ? `<td${neg(abertura)}>${brl(abertura)}</td>` : ''}<td></td></tr>
      ${data.map(x => `<tr><td>${br(x.data)}</td><td style="text-align:left">${esc(CB[x.conta_id])}</td><td style="text-align:left">${esc(N[x.categoria_id])}</td>
        <td style="text-align:left">${esc(x.descricao)}</td><td>${T[x.categoria_id] === 'receita' ? brl(x.valor) : ''}</td><td class="neg">${T[x.categoria_id] !== 'receita' ? brl(x.valor) : ''}</td>
        <td${neg(x.sc)}><b>${brl(x.sc)}</b></td>${porConta ? `<td${neg(x.st)}>${brl(x.st)}</td>` : ''}
        <td><button class="l" style="color:var(--pri)" onclick="abrirLanc(${x.id})">Editar</button>
            <button class="l" onclick="delReal(${x.id})">Excluir</button></td></tr>`).join('') || `<tr><td colspan="${porConta ? 9 : 8}" class="empty">Nenhum lançamento neste período.</td></tr>`}
      <tr class="tot"><td colspan="4">Total (saldo anterior + lançamentos)</td><td>${brl(totRec)}</td><td class="neg">${brl(totDes)}</td>
        <td${neg(saldoFinal)}>${porConta ? '' : `<b>${brl(saldoFinal)}</b>`}</td>${porConta ? `<td${neg(saldoFinal)}><b>${brl(saldoFinal)}</b></td>` : ''}<td></td></tr></table></div>
    </section>`;
  };

  let blocos;
  if (!contas.length) blocos = '<p class="empty">Cadastre uma conta em "Contas bancárias".</p>';
  else if (contaSel === 'sep') blocos = contas
    .filter(c => c.ativo || todosLanc.some(x => x.conta_id === c.id))
    .map(c => relConta([c], 'Conta: ' + c.nome)).join('');
  else if (contaSel) blocos = relConta(contas.filter(c => String(c.id) === String(contaSel)), '');
  else blocos = relConta(contas, contas.length > 1 ? 'Todas as contas juntas' : '');

  const optsF = '<option value="">Todas as categorias</option>' + cats.map(c =>
    `<option value="${c.id}"${String(c.id) === String(catSel) ? ' selected' : ''}>${esc(c.nome)}${c.ativo ? '' : ' (inativa)'}</option>`).join('');
  const optsC = `<option value=""${!contaSel ? ' selected' : ''}>Todas as contas juntas</option>
    <option value="sep"${contaSel === 'sep' ? ' selected' : ''}>Contas separadas</option>` +
    contas.map(c => `<option value="${c.id}"${String(c.id) === String(contaSel) ? ' selected' : ''}>${esc(c.nome)}${c.ativo ? '' : ' (inativa)'}</option>`).join('');

  $('#view').className = 'simples';
  $('#view').innerHTML = `
    <div class="row"><button class="p" onclick="abrirLanc()">+ Novo lançamento</button>
      <button class="p" style="background:none;border:1px solid var(--bd);color:var(--tx)" onclick="abrirContas()">+ Contas bancárias</button>
      <select id="fconta" onchange="contaSel=this.value;vRealizado()" aria-label="Conta bancária">${optsC}</select>
      ${campoBusca()}
      <select id="fcat" onchange="catSel=this.value;vRealizado()" aria-label="Filtrar por categoria">${optsF}</select></div>
    ${blocos}`;
}

let mapaCat = {};   // texto exibido -> id da categoria
function catPorTexto(t) {
  t = norm((t || '').trim());
  if (!t) return null;
  const achou = Object.entries(mapaCat).find(([k]) => norm(k) === t);
  return achou ? { id: achou[1] } : null;
}

function abrirLanc(id) {
  const x = id ? lancs.find(l => l.id === id) : null;
  editId = x ? x.id : null;
  const ativas = cats.filter(c => c.ativo);
  mapaCat = {};
  ativas.forEach(c => mapaCat[`${c.nome} (${c.tipo})`] = c.id);
  if (x && !ativas.some(c => c.id === x.categoria_id)) {
    const c = cats.find(c => c.id === x.categoria_id);
    mapaCat[`${c ? c.nome : 'Categoria ' + x.categoria_id} (inativa)`] = x.categoria_id;
  }
  $('#rc-list').innerHTML = Object.keys(mapaCat).map(k => `<option value="${esc(k)}">`).join('');
  $('#rcb').innerHTML = contas.filter(c => c.ativo || (x && x.conta_id === c.id))
    .map(c => `<option value="${c.id}">${esc(c.nome)}${c.ativo ? '' : ' (inativa)'}</option>`).join('');
  $('#rcb').value = x ? x.conta_id : ((contaSel && contaSel !== 'sep' ? contaSel : '') || (contas.find(c => c.ativo) || {}).id || '');
  $('#rd').value = x ? x.data : hoje();
  $('#rc').value = x ? (Object.keys(mapaCat).find(k => mapaCat[k] === x.categoria_id) || '') : '';
  $('#rt').value = x ? (x.descricao || '') : '';
  $('#rv').value = x ? x.valor : '';
  $('#lanc-t').textContent = x ? 'Editar lançamento' : 'Novo lançamento';
  $('#rbtn').textContent = x ? 'Salvar alteração' : 'Lançar';
  $('#lanc').showModal();
  (x ? $('#rv') : $('#rd')).focus();
}

async function addReal() {
  const v = parseFloat($('#rv').value);
  const cat = catPorTexto($('#rc').value);
  if (!cat || !$('#rd').value || !$('#rcb').value || isNaN(v)) return alert('Informe data, conta, categoria (escolha uma da lista) e valor.');
  const catId = cat.id, dt = $('#rd').value;
  const payload = { categoria_id: catId, conta_id: +$('#rcb').value, data: dt, descricao: $('#rt').value, valor: v };
  const { error } = editId
    ? await db.from('realizado').update(payload).eq('id', editId)
    : await db.from('realizado').insert(payload);
  if (error) return alert(error.message);

  const continuar = !editId;   // novo lançamento: continua na tela; edição: fecha
  if (continuar) {
    // mantém data e conta; limpa o resto para o próximo lançamento
    $('#rc').value = ''; $('#rt').value = ''; $('#rv').value = '';
    $('#rd').focus();
  } else {
    $('#lanc').close();
  }
  await vRealizado();
  await checarAlerta(catId, dt);
  if (continuar) $('#rd').focus();
}

async function delReal(id) {
  if (!confirm('Excluir este lançamento?')) return;
  const { error } = await db.from('realizado').delete().eq('id', id);
  error ? alert(error.message) : vRealizado();
}


function resetContaForm() {
  editContaId = null;
  $('#cbn').value = ''; $('#cbs').value = '';
  $('#cbbtn').textContent = 'Adicionar';
}
function listarContas() {
  $('#cbl').innerHTML = `<table><tr><th>Conta</th><th>Saldo inicial</th><th></th></tr>
    ${contas.map(c => `<tr><td>${esc(c.nome)}${c.ativo ? '' : ' <small>(inativa)</small>'}</td><td>${brl(c.saldo_inicial)}</td>
      <td><button class="l" style="color:var(--pri)" onclick="editarConta(${c.id})">Editar</button>
          <button class="l" onclick="toggleConta(${c.id},${!c.ativo})">${c.ativo ? 'Inativar' : 'Reativar'}</button></td></tr>`).join('')}</table>`;
}
function abrirContas() { resetContaForm(); listarContas(); $('#cbd').showModal(); }
function editarConta(id) {
  const c = contas.find(x => x.id === id);
  if (!c) return;
  editContaId = id;
  $('#cbn').value = c.nome; $('#cbs').value = c.saldo_inicial;
  $('#cbbtn').textContent = 'Salvar alteração';
  $('#cbn').focus();
}
async function recarregarContas() {
  const { data, error } = await db.from('contas_bancarias').select('*').order('nome');
  if (error) return alert(error.message);
  contas = data;
  listarContas();
  if (tab === 'realizado') vRealizado();
}
async function salvarConta() {
  const nome = $('#cbn').value.trim();
  if (!nome) return alert('Informe o nome da conta.');
  const payload = { nome, saldo_inicial: parseFloat($('#cbs').value) || 0 };
  const { error } = editContaId
    ? await db.from('contas_bancarias').update(payload).eq('id', editContaId)
    : await db.from('contas_bancarias').insert(payload);
  if (error) return alert(error.message);
  resetContaForm();
  recarregarContas();
}
async function toggleConta(id, ativo) {
  const { error } = await db.from('contas_bancarias').update({ ativo }).eq('id', id);
  error ? alert(error.message) : recarregarContas();
}

/* ---------- Previsto ---------- */
async function vPrevisto() {
  const { data } = await db.from('previsto').select('categoria_id,valor').eq('mes', iniAno());
  const P = Object.fromEntries(data.map(x => [x.categoria_id, x.valor]));
  $('#view').className = 'simples';
  $('#view').innerHTML = `<div class="row">${campoFiltro()}</div>
    <table><tr><th>Categoria</th><th>Previsto de ${ano()}</th></tr>
    ${cats.filter(c => c.ativo && !ehTransf(c)).map(c => `<tr data-busca="${esc(norm(c.nome))}"><td>${esc(c.nome)} <small style="color:var(--mut)">(${c.tipo})</small></td>
      <td><input type="number" step="0.01" data-c="${c.id}" value="${P[c.id] ?? ''}"></td></tr>`).join('')}</table>
    <p><button class="p" onclick="salvarPrev()">Salvar previsto</button></p>`;
}
async function salvarPrev() {
  const rows = [...document.querySelectorAll('[data-c]')].filter(i => i.value !== '')
    .map(i => ({ categoria_id: +i.dataset.c, mes: iniAno(), valor: +i.value }));
  const { error } = await db.from('previsto').upsert(rows, { onConflict: 'categoria_id,mes' });
  error ? alert(error.message) : alert('Previsto salvo.');
}

/* ---------- Categorias ---------- */
let editCatId = null;
function vCategorias() {
  editCatId = null;
  $('#view').className = 'simples';
  $('#view').innerHTML = `
    <div class="row">
      <select id="ct"><option value="despesa">Despesa</option><option value="receita">Receita</option></select>
      <input id="cg" list="l-nat" placeholder="Natureza">
      <input id="cn" placeholder="Categoria">
      <input id="cs" list="l-sub" placeholder="Subgrupo">
      <button class="p" id="cbtn" onclick="addCat()">Adicionar</button>
      <button class="l" id="ccancel" style="color:var(--mut)" onclick="vCategorias()" hidden>Cancelar</button>
    </div>
    <datalist id="l-nat"><option>Transferência</option><option>Fixa</option><option>Variável</option><option>Investimento</option><option>Venda</option><option>Compra</option><option>Banco</option><option>Emprestimo</option><option>Arrendamento</option><option>Soja</option><option>Parceria</option></datalist>
    <datalist id="l-sub"><option>Variáveis Operacional</option><option>Fixos</option><option>Receita</option><option>Variáveis Formação / Manut Pastos</option><option>Variáveis Nutrição Animal</option><option>Banco</option><option>Emprestimos</option><option>Variáveis Sanidade Animal</option><option>Soja</option><option>Investimentos</option></datalist>
    <div class="row">${campoFiltro()}</div>
    <table><tr><th>Natureza</th><th style="text-align:left">Categoria</th><th style="text-align:left">Subgrupo</th><th>Tipo</th><th></th></tr>
    ${cats.map(c => `<tr data-busca="${esc(norm(c.nome + ' ' + (c.natureza || '') + ' ' + (c.subgrupo || '')))}"><td>${esc(c.natureza)}</td><td style="text-align:left">${esc(c.nome)}${c.ativo ? '' : ' <small>(inativa)</small>'}</td>
      <td style="text-align:left">${esc(c.subgrupo)}</td><td>${c.tipo}</td>
      <td><button class="l" style="color:var(--pri)" onclick="editCat(${c.id})">Editar</button>
          <button class="l" onclick="toggleCat(${c.id},${!c.ativo})">${c.ativo ? 'Inativar' : 'Reativar'}</button></td></tr>`).join('')}</table>`;
}
async function addCat() {
  const nome = $('#cn').value.trim();
  if (!nome) return;
  const payload = {
    nome, tipo: $('#ct').value,
    natureza: $('#cg').value.trim() || null,
    subgrupo: $('#cs').value.trim() || null
  };
  const { error } = editCatId
    ? await db.from('categorias').update(payload).eq('id', editCatId)
    : await db.from('categorias').insert(payload);
  error ? alert(error.message) : render();
}
function editCat(id) {
  const c = cats.find(x => x.id === id);
  if (!c) return;
  editCatId = id;
  $('#ct').value = c.tipo;
  $('#cg').value = c.natureza || '';
  $('#cn').value = c.nome;
  $('#cs').value = c.subgrupo || '';
  $('#cbtn').textContent = 'Salvar alteração';
  $('#ccancel').hidden = false;
  $('#cn').focus();
}
async function toggleCat(id, ativo) {
  const { error } = await db.from('categorias').update({ ativo }).eq('id', id);
  error ? alert(error.message) : render();
}

/* ---------- Relatórios ---------- */
let repSel = 'sep';
function vRelatorios() {
  $('#view').className = 'simples';
  const opts = `<option value="sep"${repSel === 'sep' ? ' selected' : ''}>Cada conta separada (uma por página)</option>
    <option value="juntas"${repSel === 'juntas' ? ' selected' : ''}>Todas as contas juntas</option>` +
    contas.map(c => `<option value="${c.id}"${String(c.id) === repSel ? ' selected' : ''}>${esc(c.nome)}${c.ativo ? '' : ' (inativa)'}</option>`).join('');
  $('#view').innerHTML = `
    <div class="card" style="max-width:560px;padding:20px;display:grid;gap:12px">
      <h3 style="padding:0">Contas bancárias</h3>
      <p style="margin:0;color:var(--mut)">Extrato com saldo anterior, receitas, despesas e saldo após cada lançamento, no período ${br(ini())} a ${br($('#ate').value)} (o mesmo filtro de datas do topo).</p>
      <label style="display:grid;gap:4px;color:var(--mut);font-size:12.5px">Contas<select id="rp-conta">${opts}</select></label>
      <div><button class="p" id="rp-pdf" onclick="gerarPdfContas()">Gerar PDF</button></div>
    </div>`;
}


let logoCache = null;
function logoPng(cor = '#1f4d3a') {
  if (logoCache) return Promise.resolve(logoCache);
  const d = document.querySelector('.logo svg path').getAttribute('d');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1324 1188" width="662" height="594"><path d="${d}" fill="${cor}" fill-rule="evenodd"/></svg>`;
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 662; c.height = 594;
      c.getContext('2d').drawImage(img, 0, 0, 662, 594);
      res(logoCache = c.toDataURL('image/png'));
    };
    img.onerror = () => rej(new Error('Não foi possível carregar o logo'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

async function gerarPdfContas() {
  const btn = $('#rp-pdf');
  btn.disabled = true; btn.textContent = 'Gerando...';
  try {
    const sel = $('#rp-conta').value;
    repSel = sel;
    const { jsPDF } = window.jspdf;
    const T = Object.fromEntries(cats.map(c => [c.id, c.tipo]));
    const N = Object.fromEntries(cats.map(c => [c.id, c.nome]));
    const CB = Object.fromEntries(contas.map(c => [c.id, c.nome]));
    const de = ini(), ate = fim(), ateTxt = $('#ate').value;
    const m = v => brl(v).replace(/\u00a0/g, ' ');
    const soma = o => Object.values(o).reduce((a, b) => a + b, 0);
    const sg = x => (T[x.categoria_id] === 'receita' ? 1 : -1) * +x.valor;

    const lanc = await todos(() => {
      let s = db.from('realizado').select('*').lt('data', ate);
      if (sel !== 'sep' && sel !== 'juntas') s = s.eq('conta_id', +sel);
      return s.order('data').order('id');
    });

    const grupos = sel === 'sep'
      ? contas.filter(c => c.ativo || lanc.some(x => x.conta_id === c.id)).map(c => [c])
      : sel === 'juntas' ? [contas] : [contas.filter(c => String(c.id) === sel)];
    if (!grupos.length || !grupos[0].length) return alert('Nenhuma conta para gerar o relatório.');

    const logo = await logoPng();
    const nomeFaz = document.querySelector('.logo b').textContent;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    grupos.forEach((escopo, gi) => {
      if (gi) doc.addPage();
      const ids = new Set(escopo.map(c => c.id));
      const juntas = escopo.length > 1;
      const cur = {};
      escopo.forEach(c => cur[c.id] = +c.saldo_inicial);
      const per = [];
      lanc.filter(x => ids.has(x.conta_id)).forEach(x => {
        if (x.data < de) cur[x.conta_id] += sg(x); else per.push(x);
      });
      const abertura = soma(cur);
      let tr = 0, td = 0;
      const body = [[br(de), ...(juntas ? ['Todas'] : []), '', 'Saldo anterior', '', '', m(abertura)]];
      per.forEach(x => {
        const rec = T[x.categoria_id] === 'receita';
        cur[x.conta_id] += sg(x);
        rec ? tr += +x.valor : td += +x.valor;
        body.push([br(x.data), ...(juntas ? [CB[x.conta_id]] : []), N[x.categoria_id] || '', x.descricao || '',
          rec ? m(x.valor) : '', rec ? '' : m(x.valor), m(soma(cur))]);
      });
      body.push(['', ...(juntas ? [''] : []), '', 'Total (saldo anterior + lançamentos)', m(tr), m(td), m(abertura + tr - td)]);

      const titulo = juntas ? 'Todas as contas juntas' : 'Conta: ' + escopo[0].nome;
      const n = juntas ? 7 : 6;
      doc.addImage(logo, 'PNG', 40, 26, 50, 45);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(nomeFaz, 100, 46);
      const wPrumo = doc.getTextWidth(nomeFaz);   // <-- linha nova
      doc.setFont('helvetica', 'normal'); doc.setFontSize(12);
      doc.text('- Gestão Financeira', 100 + wPrumo + 6, 46);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.text('Extrato de contas bancárias', 100, 62);      doc.setDrawColor(31, 77, 58); doc.line(40, 80, doc.internal.pageSize.getWidth() - 40, 80);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(titulo, 40, 98);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(`Período: ${br(de)} a ${br(ateTxt)}`, 40, 114);

      doc.autoTable({
        startY: 126,
        head: [['Data', ...(juntas ? ['Conta'] : []), 'Categoria', 'Descrição', 'Receita', 'Despesa', 'Saldo']],
        body,
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [31, 77, 58] },
        didParseCell: d => {
          if (d.column.index >= n - 3) d.cell.styles.halign = 'right';
          if (d.section === 'body') {
            if (d.column.index === n - 2) d.cell.styles.textColor = [178, 58, 42];
            if (d.row.index === 0 || d.row.index === body.length - 1) {
              d.cell.styles.fontStyle = 'bold';
              d.cell.styles.fillColor = [230, 238, 233];
            }
          }
        }
      });
    });

    const pags = doc.getNumberOfPages();
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= pags; i++) {
      doc.setPage(i); doc.setFontSize(8);
      doc.text(`Página ${i} de ${pags}  -  gerado em ${br(hoje())}`, W - 40, H - 20, { align: 'right' });
    }
    doc.save(`Fazenda Carioca - ${de}_a_${ateTxt}.pdf`);
  } catch (err) {
    alert('Não foi possível gerar o PDF: ' + (err.message || err));
  } finally {
    btn.disabled = false; btn.textContent = 'Gerar PDF';
  }
}

/* ---------- Resultados (dashboard) ---------- */
const curto = v => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace('.', ',') + ' mi'
  : Math.abs(v) >= 1e3 ? Math.round(v / 1e3) + ' mil' : String(Math.round(v));

function graficoBarras(meses, series) {
  const W = 900, H = 300, L = 64, R = 10, Tp = 12, B = 34;
  const n = meses.length, gw = (W - L - R) / n;
  const max = Math.max(1, ...series.flatMap(s => s.vals));
  const bw = Math.min(30, gw * 0.8 / series.length);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const y = Tp + (H - Tp - B) * (1 - i / 4), v = max * i / 4;
    g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#1b3a2a"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" fill="#8aa596" font-size="11">${curto(v)}</text>`;
  }
  meses.forEach((k, i) => {
    const x0 = L + gw * i + (gw - bw * series.length) / 2;
    series.forEach((s, j) => {
      const h = (H - Tp - B) * s.vals[i] / max;
      g += `<rect x="${x0 + bw * j}" y="${H - B - h}" width="${bw - 2}" height="${Math.max(h, 0)}" rx="3" fill="${s.cor}"><title>${s.nome} - ${k.slice(5)}/${k.slice(2, 4)}: ${brl(s.vals[i])}</title></rect>`;
    });
    if (n <= 16 || i % 2 === 0) g += `<text x="${L + gw * i + gw / 2}" y="${H - 12}" text-anchor="middle" fill="#8aa596" font-size="11">${k.slice(5)}/${k.slice(2, 4)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Receitas, despesas e investimentos por mês">${g}</svg>`;
}

function ranking(titulo, mapa, cor) {
  const itens = Object.entries(mapa).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const tot = itens.reduce((s, [, v]) => s + v, 0);
  const lin = itens.slice(0, 8).map(([k, v]) => `<div style="margin:10px 0">
      <div style="display:flex;justify-content:space-between;gap:10px"><span>${esc(k)}</span><span>${brl(v)} <small style="color:var(--mut)">${(v / tot * 100).toFixed(0)}%</small></span></div>
      <div style="height:8px;border-radius:4px;background:#1b2b22;margin-top:4px;overflow:hidden"><i style="display:block;height:100%;width:${v / tot * 100}%;background:${cor};border-radius:4px"></i></div></div>`).join('');
  const resto = itens.length > 8 ? `<small style="color:var(--mut)">+ ${itens.length - 8} outros</small>` : '';
  return `<div class="card" style="padding:16px 18px"><b>${titulo}</b>${lin || '<p style="color:var(--mut);margin:12px 0 0">Sem movimento no período.</p>'}${resto}</div>`;
}

const PALETA = ['#2fd46f', '#ffd166', '#4cc9f0', '#ff5a4a', '#b388ff', '#ff9f43', '#5eead4', '#f472b6'];
function rosca(titulo, mapa) {
  let itens = Object.entries(mapa).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = itens.reduce((s, [, v]) => s + v, 0);
  if (!total) return `<div class="card" style="padding:16px 18px"><b>${titulo}</b><p style="color:var(--mut);margin:12px 0 0">Sem movimento no período.</p></div>`;
  if (itens.length > 8) {
    const resto = itens.slice(7).reduce((s, [, v]) => s + v, 0);
    itens = [...itens.slice(0, 7), ['Outros', resto]];
  }
  const R = 70, C = 2 * Math.PI * R;
  let acc = 0, arcos = '', leg = '';
  itens.forEach(([k, v], i) => {
    const f = v / total, cor = PALETA[i % PALETA.length];
    arcos += `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${cor}" stroke-width="28" stroke-dasharray="${f * C} ${C}" stroke-dashoffset="${-acc * C}" transform="rotate(-90 100 100)"><title>${esc(k)}: ${brl(v)} (${(f * 100).toFixed(1)}%)</title></circle>`;
    acc += f;
    leg += `<div style="display:flex;align-items:center;gap:8px;margin:5px 0">
      <i style="width:10px;height:10px;border-radius:3px;background:${cor};flex:none"></i>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(k)}</span>
      <span style="white-space:nowrap">${brl(v)} <small style="color:var(--mut)">${(f * 100).toFixed(0)}%</small></span></div>`;
  });
  return `<div class="card" style="padding:16px 18px"><b>${titulo}</b>
    <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;margin-top:10px">
      <svg viewBox="0 0 200 200" style="width:190px;height:190px;flex:none" role="img" aria-label="${titulo}">${arcos}
        <text x="100" y="98" text-anchor="middle" fill="#e9f4ed" font-size="17" font-weight="700">R$ ${curto(total)}</text>
        <text x="100" y="116" text-anchor="middle" fill="#8aa596" font-size="11">total</text>
      </svg>
      <div style="flex:1;min-width:200px">${leg}</div>
    </div></div>`;
}

async function vResultados() {
  $('#view').className = '';
  const [p, rm, rows] = await Promise.all([
    db.from('previsto').select('categoria_id,valor').gte('mes', iniAno()).lt('mes', fimAno()),
    db.from('realizado_mensal').select('categoria_id,total').gte('mes', iniAno()).lt('mes', fimAno()),
    todos(() => db.from('realizado').select('categoria_id,conta_id,data,valor').lt('data', fim()).order('id'))
  ]);
  if (p.error) return alert(p.error.message);
  if (rm.error) return alert(rm.error.message);

  const C = Object.fromEntries(cats.map(c => [c.id, c]));
  // rec = receita | inv = despesa de investimento | des = demais despesas
  const gr = id => {
    const c = C[id];
    if (!c) return 'des';
    if (ehTransf(c)) return 'transf';
    if (c.tipo === 'receita') return 'rec';
    return norm(c.natureza).startsWith('invest') || norm(c.subgrupo).startsWith('invest') ? 'inv' : 'des';
  };
  const de = ini(), ateTxt = $('#ate').value;
  const tot = { rec: 0, des: 0, inv: 0 };
  const mes = {};
  const rk = { rec: {}, des: {}, inv: {} };
  const pcat = { rec: {}, des: {} };
  const saldoConta = Object.fromEntries(contas.map(c => [c.id, +c.saldo_inicial]));

  rows.forEach(x => {
    const g = gr(x.categoria_id), v = +x.valor;
    const entra = (C[x.categoria_id] || {}).tipo === 'receita';
    saldoConta[x.conta_id] = (saldoConta[x.conta_id] || 0) + (entra ? v : -v);
    if (g === 'transf' || x.data < de) return;
    tot[g] += v;
    (mes[x.data.slice(0, 7)] ||= { rec: 0, des: 0, inv: 0 })[g] += v;
    const c = C[x.categoria_id];
    const nome = g === 'des' ? ((c && c.subgrupo) || '(sem subgrupo)') : (c ? c.nome : '?');
    rk[g][nome] = (rk[g][nome] || 0) + v;
    if (g !== 'inv') { const cn = c ? c.nome : '?'; pcat[g][cn] = (pcat[g][cn] || 0) + v; }
  });

  // previsto x realizado do ano rural
  const pa = { rec: 0, des: 0, inv: 0 }, ra = { rec: 0, des: 0, inv: 0 };
  p.data.forEach(x => { const g = gr(x.categoria_id); if (g !== 'transf') pa[g] += +x.valor; });
  rm.data.forEach(x => { const g = gr(x.categoria_id); if (g !== 'transf') ra[g] += +x.total; });

  // meses do período
  const meses = [];
  let [y, mm] = de.slice(0, 7).split('-').map(Number);
  const fimM = ateTxt.slice(0, 7);
  for (;;) {
    const k = `${y}-${String(mm).padStart(2, '0')}`;
    meses.push(k);
    if (k >= fimM || meses.length > 120) break;
    if (++mm > 12) { mm = 1; y++; }
  }
  const serie = g => meses.map(k => (mes[k] || {})[g] || 0);

  const res = tot.rec - tot.des - tot.inv, resOp = tot.rec - tot.des;
  const margem = tot.rec > 0 ? res / tot.rec * 100 : 0;
  const caixa = Object.values(saldoConta).reduce((a, b) => a + b, 0);
  const kpi = (t, v, cor, nota) => `<div class="card" style="padding:16px 18px"><small style="color:var(--mut)">${t}</small>
    <div style="font-size:24px;font-weight:700;color:${cor}">${brl(v)}</div><small style="color:var(--mut)">${nota || '&nbsp;'}</small></div>`;

  const linhaPR = (nome, g) => {
    const a = pa[g], b = ra[g], s = g === 'rec' ? b - a : a - b, pc = a > 0 ? b / a * 100 : 0;
    return `<tr><td>${nome}</td><td>${brl(a)}</td><td>${brl(b)}</td><td class="${s < 0 ? 'neg' : ''}">${brl(s)}</td>
      <td><span class="bar"><i class="${g !== 'rec' && b > a ? 'over' : ''}" style="width:${Math.min(pc, 100)}%"></i></span>${pc.toFixed(0)}%</td></tr>`;
  };
  const resA = pa.rec - pa.des - pa.inv, resB = ra.rec - ra.des - ra.inv;

  const cartoesConta = contas.filter(c => c.ativo || Math.abs(saldoConta[c.id] - c.saldo_inicial) > 0.004)
    .map(c => kpi(esc(c.nome), saldoConta[c.id], saldoConta[c.id] < 0 ? 'var(--bad)' : 'var(--tx)')).join('');

  $('#view').innerHTML = `
    <div class="row"><span class="periodo">Período: ${br(de)} a ${br(ateTxt)} • Ano rural ${ano()}</span></div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-bottom:18px">
      ${kpi('Receitas', tot.rec, 'var(--pri)')}
      ${kpi('Despesas', tot.des, 'var(--bad)', 'sem investimentos')}
      ${kpi('Investimentos', tot.inv, 'var(--acc)')}
      ${kpi('Resultado', res, res >= 0 ? 'var(--pri)' : 'var(--bad)', `Operacional: ${brl(resOp)} • margem ${margem.toFixed(0)}%`)}
      ${kpi('Saldo em caixa', caixa, caixa < 0 ? 'var(--bad)' : 'var(--tx)', `todas as contas em ${br(ateTxt)}`)}
    </div>

    <div class="card" style="padding:16px 18px;margin-bottom:18px">
      <b>Receitas x despesas x investimentos por mês</b>
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin:8px 0;color:var(--mut)">
        <span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#2fd46f"></i> Receitas</span>
        <span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#ff5a4a"></i> Despesas</span>
        <span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#ffd166"></i> Investimentos</span>
      </div>
      ${graficoBarras(meses, [
        { nome: 'Receitas', cor: '#2fd46f', vals: serie('rec') },
        { nome: 'Despesas', cor: '#ff5a4a', vals: serie('des') },
        { nome: 'Investimentos', cor: '#ffd166', vals: serie('inv') }
      ])}
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px;margin-bottom:18px">
      ${rosca('Receitas por categoria', pcat.rec)}
      ${rosca('Despesas por categoria', pcat.des)}
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-bottom:18px">
      ${ranking('Receitas por categoria', rk.rec, '#2fd46f')}
      ${ranking('Despesas por subgrupo', rk.des, '#ff5a4a')}
      ${ranking('Investimentos por categoria', rk.inv, '#ffd166')}
    </div>

    <div class="card" style="margin-bottom:18px">
      <h3>Previsto x realizado no ano rural ${ano()}</h3>
      <div class="scroll"><table>
        <tr><th>Grupo</th><th>Previsto (ano)</th><th>Realizado (ano)</th><th>Saldo</th><th>Execução</th></tr>
        ${linhaPR('Receitas', 'rec')}${linhaPR('Despesas', 'des')}${linhaPR('Investimentos', 'inv')}
        <tr class="tot"><td>Resultado</td><td>${brl(resA)}</td><td>${brl(resB)}</td><td class="${resB - resA < 0 ? 'neg' : ''}">${brl(resB - resA)}</td><td></td></tr>
      </table></div>
    </div>

    <div class="card" style="padding:16px 18px">
      <b>Saldo por conta bancária em ${br(ateTxt)}</b>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-top:12px">${cartoesConta || '<span style="color:var(--mut)">Nenhuma conta cadastrada.</span>'}</div>
    </div>`;
}

/* ---------- Detalhe ao clicar no Painel ---------- */
$('#view').addEventListener('click', e => {
  const el = e.target.closest('[data-ids]');
  if (!el) return;
  detalhe(el.dataset.ids.split(',').map(Number), el.dataset.nome);
});
$('#det-x').onclick = () => $('#det').close();
$('#det').addEventListener('click', e => { if (e.target.id === 'det') $('#det').close(); });
$('#lanc-x').onclick = () => $('#lanc').close();
$('#lanc').addEventListener('click', e => { if (e.target.id === 'lanc') $('#lanc').close(); });
const ordemLanc = ['rd', 'rcb', 'rc', 'rt', 'rv'];
$('#lanc').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const i = ordemLanc.indexOf(e.target.id);
  if (i < 0) return;                       // botões etc.: comportamento normal

  if (e.target.id === 'rc') {
    // categoria: só avança se o texto bater com uma categoria da lista
    // (setTimeout espera o navegador aplicar a sugestão escolhida)
    setTimeout(() => { if (catPorTexto($('#rc').value)) $('#rt').focus(); }, 0);
    return;
  }

  e.preventDefault();
  if (i === ordemLanc.length - 1) addReal();   // último campo (Valor): lança
  else $('#' + ordemLanc[i + 1]).focus();      // demais: vai para o próximo
});
$('#cbd-x').onclick = () => $('#cbd').close();
$('#cbd').addEventListener('click', e => { if (e.target.id === 'cbd') $('#cbd').close(); });


async function detalhe(ids, titulo) {
  let data;
  try {
    data = await todos(() => db.from('realizado').select('*')
      .in('categoria_id', ids).gte('data', ini()).lt('data', fim())
      .order('data', { ascending: false }).order('id'));
  } catch (err) { return alert(err.message); }
  const N = Object.fromEntries(cats.map(c => [c.id, c.nome]));
  const total = data.reduce((s, x) => s + +x.valor, 0);
  $('#det-t').textContent = `${titulo} • ${br(ini())} a ${br($('#ate').value)}`;
  $('#det-c').innerHTML = data.length
    ? `<table><tr><th>Data</th><th style="text-align:left">Categoria</th><th style="text-align:left">Descrição</th><th>Valor</th></tr>
       ${data.map(x => `<tr><td>${br(x.data)}</td><td style="text-align:left">${esc(N[x.categoria_id])}</td>
         <td style="text-align:left">${esc(x.descricao)}</td><td>${brl(x.valor)}</td></tr>`).join('')}
       <tr class="tot"><td colspan="3">Total (${data.length} lançamento${data.length > 1 ? 's' : ''})</td><td>${brl(total)}</td></tr></table>`
    : '<p class="empty">Nenhum lançamento neste período.</p>';
  $('#det').showModal();
}

/* ---------- Usuários (somente administrador) ---------- */
const ABAS = [['painel', 'Painel'], ['realizado', 'Conta corrente'], ['previsto', 'Previsto'],
              ['categorias', 'Plano de contas'], ['relatorios', 'Relatórios'], ['resultados', 'Resultados']];
let usuarios = [];

const checksUsuario = u => `<div class="usr-ck">`
  + ABAS.map(([k, n]) => `<label><input type="checkbox" data-aba="${k}"${(u.abas || []).includes(k) ? ' checked' : ''}> ${n}</label>`).join('')
  + `<label><input type="checkbox" data-f="editar"${u.editar ? ' checked' : ''}> Pode lançar</label>`
  + `<label><input type="checkbox" data-f="admin"${u.admin ? ' checked' : ''}> Administrador</label></div>`;

const lerCartao = el => ({
  abas: [...el.querySelectorAll('[data-aba]:checked')].map(i => i.dataset.aba),
  editar: el.querySelector('[data-f=editar]').checked,
  admin: el.querySelector('[data-f=admin]').checked
});

const cartaoUsuario = u => `<div class="card usr" data-u="${u.user_id}">
  <div class="usr-t"><b>${esc(u.email)}</b>${u.tem_perfil ? '' : '<span class="tag">sem acesso</span>'}</div>
  <div class="usr-c"><input class="un" placeholder="Nome" value="${esc(u.nome || '')}"></div>
  ${checksUsuario(u)}
  <div class="usr-b"><button class="p" onclick="salvarUsuario('${u.user_id}')">Salvar</button>
    ${u.tem_perfil ? `<button class="l" onclick="removerAcesso('${u.user_id}')">Remover acesso</button>` : ''}</div>
</div>`;

async function vUsuarios() {
  $('#view').className = 'simples';
  const { data, error } = await db.rpc('listar_usuarios');
  if (error) return alert(error.message);
  usuarios = data || [];
  $('#view').innerHTML = `
    <div class="card usr novo">
      <h3>Novo usuário</h3>
      <div class="usr-c">
        <input id="un" placeholder="Nome">
        <input id="ue" type="email" placeholder="E-mail" autocomplete="off">
        <input id="us" placeholder="Senha (mínimo 6 caracteres)" autocomplete="off">
      </div>
      ${checksUsuario({ abas: ['painel'], editar: false, admin: false })}
      <div class="usr-b"><button class="p" onclick="criarUsuario()">Criar usuário</button></div>
    </div>
    ${usuarios.map(cartaoUsuario).join('')}`;
}

async function criarUsuario() {
  const email = $('#ue').value.trim(), senha = $('#us').value, nome = $('#un').value.trim();
  if (!email || senha.length < 6) return alert('Informe o e-mail e uma senha com pelo menos 6 caracteres.');
  const v = lerCartao(document.querySelector('.usr.novo'));
  if (!v.admin && !v.abas.length) return alert('Marque pelo menos uma aba.');
  // cliente separado, para não trocar a sua sessão de administrador
  const aux = supabase.createClient(SUPABASE_URL, SUPABASE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'prumo-cadastro' } });
  const { data, error } = await aux.auth.signUp({ email, password: senha });
  if (error) return alert('Não foi possível criar o login: ' + error.message);
  if (!data.user || !(data.user.identities || []).length) return alert('Este e-mail já está cadastrado.');
  const { error: e2 } = await db.from('permissoes')
    .upsert({ user_id: data.user.id, nome: nome || email, ...v }, { onConflict: 'user_id' });
  if (e2) return alert('Login criado, mas as permissões falharam: ' + e2.message);
  alert('Usuário criado. Passe o e-mail e a senha para a pessoa.');
  vUsuarios();
}

async function salvarUsuario(id) {
  const el = document.querySelector(`.usr[data-u="${id}"]`);
  const u = usuarios.find(x => x.user_id === id);
  const v = lerCartao(el);
  if (id === meuId && !v.admin) return alert('Você não pode tirar o seu próprio acesso de administrador.');
  if (!v.admin && !v.abas.length) return alert('Marque pelo menos uma aba.');
  const { error } = await db.from('permissoes')
    .upsert({ user_id: id, nome: el.querySelector('.un').value.trim() || u.email, ...v }, { onConflict: 'user_id' });
  if (error) return alert(error.message);
  alert('Salvo.');
  vUsuarios();
}

async function removerAcesso(id) {
  if (id === meuId) return alert('Você não pode remover o seu próprio acesso.');
  if (!confirm('Remover o acesso deste usuário? O login continua existindo, mas ele não verá nenhum dado.')) return;
  const { error } = await db.from('permissoes').delete().eq('user_id', id);
  error ? alert(error.message) : vUsuarios();
}

/* ---------- Backup ---------- */
$('#bk').onclick = async () => {
  const out = { gerado_em: new Date().toISOString() };
  for (const t of ['categorias', 'previsto', 'realizado', 'contas_bancarias']) {
    let all = [], from = 0;
    while (true) {
      const { data, error } = await db.from(t).select('*').order('id').range(from, from + 999);
      if (error) return alert(error.message);
      all = all.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }
    out[t] = all;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
  a.download = `backup-${hoje()}.json`;
  a.click();
};

init();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
