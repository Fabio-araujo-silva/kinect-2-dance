// A partida: toca o vídeo, lê você pela webcam, compara e dá a nota.
import * as A from './analise.js';
import * as D from './desenho.js';
import { detectorAoVivo, tsCrescente } from './pose.js';

const $ = (id) => document.getElementById(id);
const JANELA = 1.0;          // segundos de vídeo por "movimento" julgado
const TEMPO_CHECAGEM = 1.0;  // segundos com o corpo visível antes de começar

export class Jogo {
  constructor(danca, opcoes, { aoTerminar, aoSair }) {
    this.danca = danca;
    this.op = opcoes;  // { vel, dificuldade, esqueletoRef, fantasma, trecho: {ini, fim} | null }
    this.aoTerminar = aoTerminar;
    this.aoSair = aoSair;
    this.tol = A.DIFICULDADES[opcoes.dificuldade]?.tol ?? A.DIFICULDADES.normal.tol;
    this.quadro = this.quadro.bind(this);
    this.tecla = this.tecla.bind(this);
  }

  async iniciar() {
    const d = this.danca;
    this.vRef = $('video-ref'); this.vCam = $('video-cam');
    this.cRef = $('canvas-ref'); this.cCam = $('canvas-cam');
    this.ctxRef = this.cRef.getContext('2d'); this.ctxCam = this.cCam.getContext('2d');

    // coreografia pré-calculada
    const n = d.frames.length / A.STRIDE;
    this.n = n;
    this.refT = new Float32Array(n);
    this.refF = new Array(n);
    this.refTemCorpo = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      this.refT[i] = d.frames[i * A.STRIDE];
      this.refF[i] = A.extrair(d.frames, i * A.STRIDE, d.aspecto, false).f;
      this.refTemCorpo[i] = A.quadroVazio(this.refF[i]) ? 0 : 1;
    }
    this.refP = A.pesosDinamicos(this.refF, this.refT);
    this.ini = this.op.trecho ? this.op.trecho.ini : 0;
    this.fim = this.op.trecho ? this.op.trecho.fim : d.duracao;
    this.janelasEsperadas = this.contarJanelas();

    this.zerarPlacar();
    this.passada = 0;
    this.notasPassadas = [];
    this.uArr = new Float32Array(A.STRIDE);
    this.uOk = false;
    this.uExt = null;
    this.porSeg = new Float32Array(A.NSEG).fill(-1);
    this.medidor = 0;
    this.ultimoCamT = -1;
    this.encerrado = false;

    $('hud-vel').textContent = this.op.trecho
      ? `treino ${fmt(this.ini)}–${fmt(this.fim)} · ${this.op.vel}x`
      : `${this.op.vel}x · ${A.DIFICULDADES[this.op.dificuldade].nome}`;
    $('pontos').textContent = '0';
    $('hud-combo').textContent = '';
    $('feedback').textContent = '';
    $('dica').textContent = '';
    $('pausa').hidden = true;

    // vídeo de referência
    this.urlVideo = URL.createObjectURL(d.video);
    this.vRef.src = this.urlVideo;
    this.vRef.muted = false;
    await new Promise((ok, erro) => {
      this.vRef.onloadedmetadata = ok;
      this.vRef.onerror = () => erro(new Error('O navegador não conseguiu abrir esse vídeo.'));
    });
    this.vRef.defaultPlaybackRate = this.op.vel;
    this.vRef.playbackRate = this.op.vel;
    this.vRef.currentTime = this.ini;
    this.vRef.onended = () => {
      if (this.fase !== 'jogando') return;
      if (!this.op.trecho) return this.terminar();
      this.fecharJanela();            // treino que vai até o fim do vídeo: volta pro começo do trecho
      this.fecharPassada();
      this.vRef.currentTime = this.ini;
      this.vRef.play().catch(() => {});
    };

    // câmera + IA
    this.fase = 'checagem';
    this.mostrarChecagem('Ligando a câmera…');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false,
      });
    } catch (e) {
      this.mostrarChecagem('Não consegui acessar a câmera. Libere a permissão no navegador e tente de novo.', true);
      throw e;
    }
    this.vCam.srcObject = this.stream;
    await this.vCam.play();
    this.camAsp = (this.vCam.videoWidth || 640) / (this.vCam.videoHeight || 480);
    $('cam-box').style.aspectRatio = `${this.vCam.videoWidth || 4} / ${this.vCam.videoHeight || 3}`;
    this.mostrarChecagem('Carregando a IA…');
    this.detector = await detectorAoVivo();
    this.mostrarChecagem('Fique de corpo inteiro na câmera (uns 2 metros de distância).');
    this.inicioVisivel = null;

    window.addEventListener('keydown', this.tecla);
    this.raf = requestAnimationFrame(this.quadro);
  }

  contarJanelas() {
    let total = 0;
    const nj = Math.ceil((this.fim - this.ini) / JANELA);
    for (let j = 0; j < nj; j++) {
      const a = A.limiteInferior(this.refT, this.ini + j * JANELA);
      const b = A.limiteInferior(this.refT, this.ini + (j + 1) * JANELA);
      let c = 0;
      for (let i = a; i < b; i++) c += this.refTemCorpo[i];
      if (c >= 3) total++;
    }
    return Math.max(1, total);
  }

  zerarPlacar() {
    this.pontos = 0; this.julgadas = 0; this.combo = 0; this.maxCombo = 0;
    this.janelas = [];
    this.contagens = Object.fromEntries(A.JULGAMENTOS.map((j) => [j.chave, 0]));
    this.janelaAtual = -1;
    this.acc = { soma: 0, cont: 0, atraso: 0, contAtraso: 0 };
  }

  mostrarChecagem(msg, erro = false) {
    const el = $('checagem');
    el.hidden = false;
    el.classList.toggle('erro', erro);
    $('checagem-msg').textContent = msg;
    $('cam-box').classList.add('grande');
  }

  // ------------------------------------------------------------------ loop

  quadro(agora) {
    if (this.encerrado) return;
    this.raf = requestAnimationFrame(this.quadro);
    this.detectar(agora);
    if (this.fase === 'checagem') this.checar(agora);
    else if (this.fase === 'contagem') this.contar(agora);
    else if (this.fase === 'jogando' && !this.vRef.paused) this.pontuar();
    this.desenhar();
  }

  detectar(agora) {
    const v = this.vCam;
    if (!this.detector || v.readyState < 2 || v.currentTime === this.ultimoCamT) return;
    this.ultimoCamT = v.currentTime;
    const r = this.detector.detectForVideo(v, tsCrescente(agora));
    const lms = r.landmarks && r.landmarks[0];
    this.uOk = !!lms;
    A.empacotar(lms, 0, this.uArr, 0);
    this.uExt = A.extrair(this.uArr, 0, this.camAsp, true);
  }

  checar(agora) {
    if (!this.detector) return;
    const ok = this.uOk && A.temCorpo(this.uExt.f);
    const f = this.uExt?.f;
    const pernas = f && (f[4 * 3 + 2] || f[6 * 3 + 2]);
    if (!ok) {
      this.inicioVisivel = null;
      $('checagem-msg').textContent = this.uOk
        ? 'Quase! Afaste-se até aparecerem os ombros e o quadril.'
        : 'Fique de corpo inteiro na câmera (uns 2 metros de distância).';
      return;
    }
    if (this.inicioVisivel == null) this.inicioVisivel = agora;
    $('checagem-msg').textContent = pernas
      ? 'Te achei! Segura aí…'
      : 'Te achei! (as pernas não aparecem — vou pontuar só da cintura pra cima)';
    if ((agora - this.inicioVisivel) / 1000 >= TEMPO_CHECAGEM) this.comecarContagem();
  }

  comecarContagem() {
    this.fase = 'contagem';
    this.inicioContagem = performance.now();
    $('checagem').hidden = true;
    $('cam-box').classList.remove('grande');
  }

  contar(agora) {
    const resta = 3 - (agora - this.inicioContagem) / 1000;
    const el = $('contagem');
    if (resta > 0) {
      const txt = String(Math.ceil(resta));
      if (el.textContent !== txt) { el.textContent = txt; pulsar(el); }
      return;
    }
    el.textContent = '';
    this.fase = 'jogando';
    this.vRef.currentTime = this.ini;
    this.vRef.play().catch(() => {});
  }

  pontuar() {
    const t = this.vRef.currentTime;
    const rate = this.vRef.playbackRate || 1;

    // treino em loop: chegou no fim do trecho, fecha a passada e volta
    if (this.op.trecho && t >= this.fim) {
      this.fecharJanela();
      this.fecharPassada();
      this.vRef.currentTime = this.ini;
      return;
    }

    // você reage com um pouco de atraso: procura a melhor pose da coreografia num intervalo
    const { nota: melhor, idx: melhorI } = A.melhorNaJanela(this.uExt.f, this.refF, this.refT, this.refP, t, rate, this.tol);
    this.iMelhor = melhorI;
    if (melhorI < 0 || melhor < 0) { this.porSeg.fill(-1); return; }  // dançarino fora do vídeo: não conta
    A.comparar(this.uExt.f, this.refF[melhorI], this.tol, this.porSeg, this.refP[melhorI]);
    this.medidor += (melhor - this.medidor) * 0.25;

    const j = Math.floor((t - this.ini) / JANELA);
    if (j !== this.janelaAtual) {
      this.fecharJanela();
      this.janelaAtual = j;
      this.t0Janela = this.ini + j * JANELA;
    }
    this.acc.soma += melhor;
    this.acc.cont++;
    if (melhor > 0.35) { this.acc.atraso += (t - this.refT[melhorI]) / rate; this.acc.contAtraso++; }
  }

  fecharJanela() {
    const a = this.acc;
    this.acc = { soma: 0, cont: 0, atraso: 0, contAtraso: 0 };
    if (this.janelaAtual < 0 || a.cont < 3) return;
    const media = a.soma / a.cont;
    const jul = A.julgar(media);
    this.contagens[jul.chave]++;
    this.pontos += jul.valor;
    this.julgadas++;
    this.combo = jul.valor >= 0.55 ? this.combo + 1 : 0;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.janelas.push({ t0: this.t0Janela, media, chave: jul.chave });

    const fb = $('feedback');
    fb.textContent = jul.nome;
    fb.style.color = jul.cor;
    pulsar(fb);
    const atrasoMedio = a.contAtraso ? a.atraso / a.contAtraso : 0;
    $('dica').textContent = media >= 0.35 && atrasoMedio > 0.3 ? 'um pouquinho atrasado — antecipe!' : '';
    $('pontos').textContent = Math.round(this.pontos / this.janelasEsperadas * 10000).toLocaleString('pt-BR');
    $('hud-combo').textContent = this.combo >= 3 ? `combo x${this.combo}` : '';
  }

  fecharPassada() {
    if (!this.julgadas) return;
    this.passada++;
    const pct = this.pontos / this.julgadas;
    this.notasPassadas.push(pct);
    $('hud-vel').textContent = `treino ${fmt(this.ini)}–${fmt(this.fim)} · ${this.op.vel}x · passada ${this.passada}: ${Math.round(pct * 100)}%`;
    const fb = $('feedback');
    fb.textContent = `${Math.round(pct * 100)}%`;
    fb.style.color = A.julgar(pct).cor;
    pulsar(fb);
    this.zerarPlacar();
  }

  terminar() {
    if (this.fase === 'fim') return;
    this.fecharJanela();
    this.fase = 'fim';
    const pct = this.julgadas ? this.pontos / this.julgadas : 0;
    const resultado = {
      pct,
      pontos: Math.round(pct * 10000),
      estrelas: A.estrelas(pct),
      contagens: this.contagens,
      maxCombo: this.maxCombo,
      janelas: this.janelas,
      piorTrecho: piorTrecho(this.janelas, this.danca.duracao),
      vel: this.op.vel,
      dificuldade: this.op.dificuldade,
    };
    this.encerrar();
    this.aoTerminar(resultado);
  }

  // ------------------------------------------------------------------ desenho

  desenhar() {
    const dpr = D.ajustarCanvas(this.cRef);
    const ctx = this.ctxRef;
    ctx.clearRect(0, 0, this.cRef.width, this.cRef.height);
    const rect = D.retanguloContain(this.cRef.width, this.cRef.height, this.vRef.videoWidth, this.vRef.videoHeight);
    const t = this.vRef.currentTime;
    let iRef = Math.min(this.n - 1, A.limiteInferior(this.refT, t));
    if (iRef > 0 && Math.abs(this.refT[iRef - 1] - t) < Math.abs(this.refT[iRef] - t)) iRef--;
    if (this.op.esqueletoRef && this.refTemCorpo[iRef]) {
      ctx.globalAlpha = 0.55;
      D.desenharEsqueleto(ctx, this.danca.frames, iRef * A.STRIDE, rect, { cor: '#ffffff', espessura: 3 * dpr });
      ctx.globalAlpha = 1;
    }
    if (this.op.fantasma && this.uOk && this.refTemCorpo[iRef]) {
      D.desenharFantasma(ctx, this.uArr, this.camAsp, this.danca.frames, iRef * A.STRIDE, this.danca.aspecto, rect, '#ff3ea5', 5 * dpr);
    }

    const dprC = D.ajustarCanvas(this.cCam);
    const c2 = this.ctxCam;
    c2.clearRect(0, 0, this.cCam.width, this.cCam.height);
    if (this.uOk) {
      const cores = this.fase === 'jogando' ? D.coresPorSegmento(this.uExt.pares, this.porSeg) : null;
      D.desenharEsqueleto(c2, this.uArr, 0, { x: 0, y: 0, w: this.cCam.width, h: this.cCam.height },
        { espelhar: true, cor: '#ffffff', cores, espessura: 4 * dprC });
    }

    const m = $('medidor-barra');
    m.style.width = `${Math.round(Math.max(0, this.medidor) * 100)}%`;
    m.style.background = D.corNota(this.medidor);
    const prog = (t - this.ini) / Math.max(0.01, this.fim - this.ini);
    $('barra-tempo-prog').style.width = `${Math.max(0, Math.min(1, prog)) * 100}%`;
  }

  // ------------------------------------------------------------------ controles

  tecla(e) {
    if (e.code === 'Space' || e.code === 'Escape') {
      e.preventDefault();
      if (this.fase === 'checagem' && e.code === 'Space' && this.detector) return this.comecarContagem();
      if (this.fase === 'checagem' && e.code === 'Escape') return this.sair();
      this.alternarPausa();
    }
  }

  alternarPausa() {
    if (this.fase !== 'jogando') return;
    const p = $('pausa');
    if (this.vRef.paused) { p.hidden = true; this.vRef.play().catch(() => {}); }
    else { this.vRef.pause(); p.hidden = false; }
  }

  recomecar() {
    $('pausa').hidden = true;
    this.zerarPlacar();
    this.passada = 0;
    $('pontos').textContent = '0';
    $('hud-combo').textContent = '';
    this.vRef.pause();
    this.vRef.currentTime = this.ini;
    this.comecarContagem();
  }

  sair() {
    if (this.op.trecho && this.fase === 'jogando') this.fecharPassada();
    this.encerrar();
    this.aoSair(this.notasPassadas);
  }

  encerrar() {
    if (this.encerrado) return;
    this.encerrado = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.tecla);
    this.vRef.pause();
    this.vRef.onended = null;
    this.vRef.removeAttribute('src');
    this.vRef.load();
    if (this.urlVideo) URL.revokeObjectURL(this.urlVideo);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.vCam.srcObject = null;
    $('checagem').hidden = true;
    $('pausa').hidden = true;
    $('contagem').textContent = '';
    $('cam-box').classList.remove('grande');
  }
}

// trecho de ~4 s com a pior média, pra treinar
function piorTrecho(janelas, duracao) {
  const TAM = 4;
  if (janelas.length < TAM) return null;
  let pior = Infinity, idx = 0;
  for (let i = 0; i + TAM <= janelas.length; i++) {
    let s = 0;
    for (let k = i; k < i + TAM; k++) s += janelas[k].media;
    if (s < pior) { pior = s; idx = i; }
  }
  const ini = Math.max(0, janelas[idx].t0 - 0.5);
  return { ini, fim: Math.min(duracao, janelas[idx + TAM - 1].t0 + JANELA + 0.5), media: pior / TAM };
}

function pulsar(el) {
  el.classList.remove('pulsar');
  void el.offsetWidth;
  el.classList.add('pulsar');
}

export function fmt(seg) {
  const s = Math.max(0, Math.round(seg));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
