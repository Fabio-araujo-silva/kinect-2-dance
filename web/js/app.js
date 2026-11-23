// Telas, biblioteca, importação e resultados.
import * as banco from './banco.js';
import * as A from './analise.js';
import * as D from './desenho.js';
import { processarVideo, FPS_ANALISE } from './importar.js';
import { Jogo, fmt } from './jogo.js';
import { detectorAoVivo, tsCrescente } from './pose.js';

const $ = (id) => document.getElementById(id);
let jogoAtual = null;

function mostrarTela(nome) {
  document.querySelectorAll('.tela').forEach((t) => t.classList.toggle('ativa', t.id === `tela-${nome}`));
}

let timerToast;
function toast(msg, ms = 4000) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => { t.hidden = true; }, ms);
}

function confirmar(msg) {
  return new Promise((ok) => {
    $('conf-msg').textContent = msg;
    $('modal-confirmar').hidden = false;
    const fim = (v) => { $('modal-confirmar').hidden = true; $('conf-sim').onclick = $('conf-nao').onclick = null; ok(v); };
    $('conf-sim').onclick = () => fim(true);
    $('conf-nao').onclick = () => fim(false);
  });
}

const estrelasTxt = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

// ============================================================ biblioteca

function melhorRecorde(d) {
  const recs = Object.values(d.recordes || {});
  if (!recs.length) return null;
  const normais = recs.filter((r) => r.vel === 1);
  return (normais.length ? normais : recs).sort((a, b) => b.pontos - a.pontos)[0];
}

async function renderLista() {
  const dancas = await banco.listar();
  const lista = $('lista');
  lista.innerHTML = '';
  $('vazio').hidden = dancas.length > 0;
  for (const d of dancas) {
    const rec = melhorRecorde(d);
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <div class="thumb"><span class="dur">${fmt(d.duracao)}</span></div>
      <div class="info">
        <h3></h3>
        <p class="meta">${rec
          ? `<span class="est">${estrelasTxt(rec.estrelas)}</span> <b>${rec.pontos.toLocaleString('pt-BR')}</b> <small>${String(rec.vel).replace('.', ',')}x</small>`
          : '<span class="fraco">ainda não dançada</span>'}</p>
        <div class="botoes">
          <button class="botao primario" data-acao="dancar">Dançar</button>
          <button class="botao" data-acao="devagar">Devagar</button>
          <button class="botao icone" data-acao="apagar" title="Apagar">✕</button>
        </div>
      </div>`;
    card.querySelector('h3').textContent = d.nome;
    if (d.thumb) card.querySelector('.thumb').style.backgroundImage = `url("${d.thumb}")`;
    card.addEventListener('click', async (e) => {
      const acao = e.target.closest('[data-acao]')?.dataset.acao;
      if (acao === 'dancar') abrirOpcoes(d, { vel: 1 });
      else if (acao === 'devagar') abrirOpcoes(d, { vel: 0.5 });
      else if (acao === 'apagar' && await confirmar(`Apagar "${d.nome}"?`)) { await banco.apagar(d.id); renderLista(); }
    });
    lista.appendChild(card);
  }
}

// ============================================================ importação

let importacao = null;

function ehVideo(arquivo) {
  return arquivo && (arquivo.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v)$/i.test(arquivo.name));
}

async function iniciarImportacao(arquivo) {
  if (!ehVideo(arquivo)) return toast('Isso não parece um vídeo.');
  const video = $('video-imp');
  const url = URL.createObjectURL(arquivo);
  importacao = { arquivo, url, sinal: { cancelado: false }, rodando: false };
  mostrarTela('importar');
  $('imp-nome').value = arquivo.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 80);
  $('imp-barra').style.width = '0%';
  $('imp-status').textContent = '';
  $('imp-info').textContent = 'Abrindo o vídeo…';
  $('imp-processar').disabled = true;
  const ctx = $('canvas-imp').getContext('2d');
  ctx.clearRect(0, 0, 9999, 9999);

  video.src = url;
  try {
    await new Promise((ok, erro) => {
      video.onloadeddata = ok;
      video.onerror = () => erro(new Error('formato'));
    });
  } catch {
    $('imp-info').textContent = '';
    $('imp-status').textContent = 'O navegador não consegue abrir esse vídeo. Converta pra MP4 (H.264) e tente de novo — vídeos .mov de iPhone (HEVC) costumam dar isso.';
    return;
  }
  const dur = video.duration;
  const estimativa = Math.ceil(dur * FPS_ANALISE * 0.15); // ~150 ms por quadro num PC comum; a barra recalcula ao vivo
  $('imp-info').textContent = `${fmt(dur)} · ${video.videoWidth}×${video.videoHeight} · processamento estimado: ~${fmt(estimativa)}`;
  if (dur > 300) $('imp-status').textContent = 'Vídeo longo! Dá pra processar, mas vai demorar. Corte só a parte da dança se puder.';
  $('imp-processar').disabled = false;
}

async function processarImportacao() {
  const imp = importacao;
  if (!imp || imp.rodando) return;
  imp.rodando = true;
  $('imp-processar').disabled = true;
  $('imp-status').textContent = 'Carregando a IA…';
  const video = $('video-imp');
  try {
    const r = await processarVideo(video, $('canvas-imp'), {
      sinal: imp.sinal,
      aoProgresso: (i, n, resta) => {
        $('imp-barra').style.width = `${(i / n) * 100}%`;
        $('imp-status').textContent = `Lendo os movimentos… ${Math.round((i / n) * 100)}% · falta ~${fmt(resta)}`;
      },
    });
    if (!r) return; // cancelado
    const proporcao = r.comCorpo / r.n;
    if (proporcao < 0.1) {
      $('imp-status').textContent = 'Não achei ninguém dançando nesse vídeo. Tente outro, com a pessoa de corpo inteiro.';
      $('imp-processar').disabled = false;
      imp.rodando = false;
      return;
    }
    const danca = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      nome: $('imp-nome').value.trim() || 'Dança sem nome',
      criado: Date.now(),
      duracao: video.duration,
      largura: video.videoWidth,
      altura: video.videoHeight,
      aspecto: video.videoWidth / video.videoHeight,
      fps: FPS_ANALISE,
      frames: r.frames,
      video: imp.arquivo,
      thumb: r.thumb,
      recordes: {},
      historico: [],
    };
    await banco.salvar(danca);
    fecharImportacao();
    await renderLista();
    toast(proporcao < 0.5
      ? `"${danca.nome}" importada, mas o dançarino só aparece em ${Math.round(proporcao * 100)}% do vídeo.`
      : `"${danca.nome}" pronta pra dançar!`);
  } catch (e) {
    console.error('[passinho]', e);
    $('imp-status').textContent = 'Deu erro ao processar: ' + (e.message || e);
    $('imp-processar').disabled = false;
    imp.rodando = false;
  }
}

function fecharImportacao() {
  if (importacao) {
    importacao.sinal.cancelado = true;
    URL.revokeObjectURL(importacao.url);
  }
  importacao = null;
  const v = $('video-imp');
  v.removeAttribute('src');
  v.load();
  mostrarTela('inicio');
}

// ============================================================ opções e jogo

const PREFS_CHAVE = 'passinho.prefs';
function prefs() {
  try { return { dificuldade: 'normal', esqueletoRef: true, fantasma: false, ...JSON.parse(localStorage.getItem(PREFS_CHAVE) || '{}') }; }
  catch { return { dificuldade: 'normal', esqueletoRef: true, fantasma: false }; }
}

function abrirOpcoes(danca, { vel = 1, trecho = null } = {}) {
  const p = prefs();
  const estado = { vel, dificuldade: p.dificuldade };
  $('op-titulo').textContent = danca.nome;
  $('op-trecho').textContent = trecho ? `Treino em loop do trecho ${fmt(trecho.ini)}–${fmt(trecho.fim)}. Saia com Esc quando quiser.` : '';
  $('op-esqueleto').checked = p.esqueletoRef;
  $('op-fantasma').checked = p.fantasma;
  const pintar = () => document.querySelectorAll('#modal-opcoes .chips').forEach((g) => {
    g.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', String(estado[g.dataset.campo]) === b.dataset.valor));
  });
  document.querySelectorAll('#modal-opcoes .chips').forEach((g) => {
    g.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      estado[g.dataset.campo] = g.dataset.campo === 'vel' ? Number(b.dataset.valor) : b.dataset.valor;
      pintar();
    };
  });
  pintar();
  $('modal-opcoes').hidden = false;
  $('op-cancelar').onclick = () => { $('modal-opcoes').hidden = true; };
  $('op-ok').onclick = () => {
    $('modal-opcoes').hidden = true;
    const op = { ...estado, esqueletoRef: $('op-esqueleto').checked, fantasma: $('op-fantasma').checked, trecho };
    localStorage.setItem(PREFS_CHAVE, JSON.stringify({ dificuldade: op.dificuldade, esqueletoRef: op.esqueletoRef, fantasma: op.fantasma }));
    iniciarJogo(danca.id, op);
  };
}

async function iniciarJogo(id, op) {
  const danca = await banco.obter(id);
  if (!danca) return toast('Não achei essa dança.');
  mostrarTela('jogo');
  jogoAtual = new Jogo(danca, op, {
    aoTerminar: (r) => { jogoAtual = null; mostrarResultado(danca, op, r); },
    aoSair: (notas) => {
      jogoAtual = null;
      mostrarTela('inicio');
      renderLista();
      if (notas.length) toast(`Treino: ${notas.length} passada(s). Melhor: ${Math.round(Math.max(...notas) * 100)}% · última: ${Math.round(notas[notas.length - 1] * 100)}%`, 6000);
    },
  });
  try {
    await jogoAtual.iniciar();
  } catch (e) {
    console.error('[passinho]', e);
    $('checagem').hidden = false;
    $('checagem').classList.add('erro');
    if (!/câmera/.test($('checagem-msg').textContent)) $('checagem-msg').textContent = 'Deu erro: ' + (e.message || e);
  }
}

$('btn-comecar-ja').onclick = () => { if (jogoAtual?.detector && jogoAtual.fase === 'checagem') jogoAtual.comecarContagem(); };
$('btn-voltar-checagem').onclick = () => jogoAtual?.sair();
$('btn-continuar').onclick = () => jogoAtual?.alternarPausa();
$('btn-recomecar').onclick = () => jogoAtual?.recomecar();
$('btn-sair').onclick = () => jogoAtual?.sair();

// ============================================================ resultado

async function mostrarResultado(dancaJogada, op, r) {
  const danca = (await banco.obter(dancaJogada.id)) || dancaJogada;
  const chave = `${r.vel}|${r.dificuldade}`;
  danca.recordes = danca.recordes || {};
  danca.historico = danca.historico || [];
  const anterior = danca.recordes[chave];
  const novoRecorde = !anterior || r.pontos > anterior.pontos;
  if (novoRecorde) danca.recordes[chave] = { pontos: r.pontos, estrelas: r.estrelas, vel: r.vel, dificuldade: r.dificuldade, quando: Date.now() };
  danca.historico.push({ quando: Date.now(), pct: r.pct, pontos: r.pontos, vel: r.vel, dificuldade: r.dificuldade });
  await banco.salvar(danca);

  mostrarTela('resultado');
  $('res-modo').textContent = `${String(r.vel).replace('.', ',')}x · ${A.DIFICULDADES[r.dificuldade].nome}`;
  $('res-nome').textContent = danca.nome;
  $('res-estrelas').textContent = estrelasTxt(r.estrelas);
  $('res-recorde').textContent = novoRecorde ? (anterior ? `Novo recorde! (antes: ${anterior.pontos.toLocaleString('pt-BR')})` : 'Primeiro recorde!') : `Recorde: ${anterior.pontos.toLocaleString('pt-BR')}`;
  animarNumero($('res-pontos'), r.pontos);

  const cont = $('res-contagens');
  cont.innerHTML = '';
  for (const j of A.JULGAMENTOS) {
    const el = document.createElement('div');
    el.innerHTML = `<b style="color:${j.cor}">${r.contagens[j.chave]}</b><span>${j.nome.replace('!', '')}</span>`;
    cont.appendChild(el);
  }
  const elCombo = document.createElement('div');
  elCombo.innerHTML = `<b>${r.maxCombo}</b><span>MAIOR COMBO</span>`;
  cont.appendChild(elCombo);

  desenharLinha($('res-linha'), r.janelas);

  const pior = r.piorTrecho;
  $('res-treinar').hidden = !pior;
  $('res-pior').textContent = pior ? `Trecho mais difícil pra você: ${fmt(pior.ini)}–${fmt(pior.fim)} (média ${Math.round(pior.media * 100)}%).` : '';
  $('res-treinar').onclick = () => abrirOpcoes(danca, { vel: 0.75, trecho: pior });
  $('res-denovo').onclick = () => abrirOpcoes(danca, { vel: op.vel });
  $('res-voltar').onclick = () => { mostrarTela('inicio'); renderLista(); };
}

function animarNumero(el, alvo) {
  const ini = performance.now(), dur = 1200;
  const passo = (agora) => {
    const p = Math.min(1, (agora - ini) / dur);
    el.textContent = Math.round(alvo * (1 - Math.pow(1 - p, 3))).toLocaleString('pt-BR');
    if (p < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

function desenharLinha(canvas, janelas) {
  const dpr = D.ajustarCanvas(canvas);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!janelas.length) return;
  const w = canvas.width / janelas.length;
  const cores = Object.fromEntries(A.JULGAMENTOS.map((j) => [j.chave, j.cor]));
  janelas.forEach((j, i) => {
    const h = Math.max(3 * dpr, j.media * canvas.height);
    ctx.fillStyle = cores[j.chave];
    ctx.fillRect(i * w + 0.5 * dpr, canvas.height - h, Math.max(1, w - dpr), h);
  });
}

// ============================================================ teste de câmera

let teste = null;
async function abrirTesteCamera() {
  $('modal-camera').hidden = false;
  const v = $('teste-video'), c = $('teste-canvas'), msg = $('teste-msg');
  msg.textContent = 'Ligando a câmera…';
  teste = { ativo: true };
  try {
    teste.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
    if (!teste?.ativo) return teste?.stream?.getTracks().forEach((t) => t.stop());
    v.srcObject = teste.stream;
    await v.play();
    msg.textContent = 'Carregando a IA…';
    const det = await detectorAoVivo();
    const arr = new Float32Array(A.STRIDE);
    const asp = v.videoWidth / v.videoHeight;
    let ultimo = -1, quadros = 0, t0 = performance.now(), fps = 0;
    const loop = (agora) => {
      if (!teste?.ativo) return;
      requestAnimationFrame(loop);
      if (v.readyState < 2 || v.currentTime === ultimo) return;
      ultimo = v.currentTime;
      const r = det.detectForVideo(v, tsCrescente(agora));
      const lms = r.landmarks && r.landmarks[0];
      A.empacotar(lms, 0, arr, 0);
      quadros++;
      if (agora - t0 > 1000) { fps = Math.round(quadros * 1000 / (agora - t0)); quadros = 0; t0 = agora; }
      const dpr = D.ajustarCanvas(c);
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      if (lms) D.desenharEsqueleto(ctx, arr, 0, { x: 0, y: 0, w: c.width, h: c.height }, { espelhar: true, cor: '#3ee07f', espessura: 4 * dpr });
      const f = A.extrair(arr, 0, asp, true).f;
      const pernas = f[4 * 3 + 2] || f[6 * 3 + 2];
      msg.textContent = !lms ? `Não estou te vendo. · ${fps} fps`
        : !A.temCorpo(f) ? `Afaste-se até aparecerem ombros e quadril. · ${fps} fps`
        : `Tudo certo${pernas ? ', corpo inteiro!' : ' (pernas fora da câmera)'} · ${fps} fps`;
    };
    requestAnimationFrame(loop);
  } catch (e) {
    console.error('[passinho]', e);
    msg.textContent = 'Não consegui usar a câmera: ' + (e.message || e);
  }
}
function fecharTesteCamera() {
  if (teste) { teste.ativo = false; teste.stream?.getTracks().forEach((t) => t.stop()); }
  teste = null;
  $('teste-video').srcObject = null;
  $('modal-camera').hidden = true;
}

// ============================================================ eventos

$('arquivo').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) iniciarImportacao(f);
});
$('imp-processar').onclick = processarImportacao;
$('imp-cancelar').onclick = fecharImportacao;
$('btn-camera').onclick = abrirTesteCamera;
$('teste-fechar').onclick = fecharTesteCamera;

const telaInicio = $('tela-inicio');
let profundidadeArraste = 0;
telaInicio.addEventListener('dragenter', (e) => { e.preventDefault(); profundidadeArraste++; $('soltar').hidden = false; });
telaInicio.addEventListener('dragover', (e) => e.preventDefault());
telaInicio.addEventListener('dragleave', () => { if (--profundidadeArraste <= 0) { profundidadeArraste = 0; $('soltar').hidden = true; } });
telaInicio.addEventListener('drop', (e) => {
  e.preventDefault();
  profundidadeArraste = 0;
  $('soltar').hidden = true;
  const f = e.dataTransfer.files[0];
  if (f) iniciarImportacao(f);
});

renderLista();
detectorAoVivo().catch(() => {}); // já vai aquecendo a IA ao vivo em segundo plano
