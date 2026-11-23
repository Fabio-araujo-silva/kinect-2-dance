// Coreografia sintética: valida se a nota separa quem dança certo de quem não dança.
const A = await import(new URL('../web/js/analise.js', import.meta.url).href);

const FPS = 15;
const rad = (g) => g * Math.PI / 180;
// ângulos em graus na imagem (0 = direita, 90 = baixo). "esq" = lado esquerdo do CORPO (fica à direita da imagem)
const POSES = {
  parado:   { bE: [85, 90], bD: [95, 90], pE: [90, 90], pD: [90, 90] },
  cima:     { bE: [-60, -70], bD: [-120, -110], pE: [90, 90], pD: [90, 90] },
  T:        { bE: [0, 0], bD: [180, 180], pE: [90, 90], pD: [90, 90] },
  esqCima:  { bE: [-80, -90], bD: [95, 90], pE: [90, 90], pD: [90, 90] },
  dirCima:  { bE: [85, 90], bD: [-100, -90], pE: [90, 90], pD: [90, 90] },
  agacha:   { bE: [60, 10], bD: [120, 170], pE: [40, 120], pD: [140, 60] },
  cintura:  { bE: [45, 150], bD: [135, 30], pE: [80, 95], pD: [100, 85] },
  passoE:   { bE: [70, 60], bD: [110, 120], pE: [60, 100], pD: [90, 90] },
};

function interp(a, b, u) {
  const r = {};
  for (const k of Object.keys(a)) r[k] = a[k].map((v, i) => v + (b[k][i] - v) * u);
  return r;
}

function quadro(p, ruido, t, out, off) {
  const L = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.2, visibility: 0.99 }));
  const n = () => (Math.random() - 0.5) * 2 * ruido;
  const oE = { x: 0.58, y: 0.35 }, oD = { x: 0.42, y: 0.35 }, qE = { x: 0.55, y: 0.6 }, qD = { x: 0.45, y: 0.6 };
  const cad = (base, angs, comp, idx) => {
    let x = base.x, y = base.y;
    L[idx[0]] = { x, y, visibility: 0.99 };
    angs.forEach((g, i) => {
      x += Math.cos(rad(g + n())) * comp[i];
      y += Math.sin(rad(g + n())) * comp[i];
      L[idx[i + 1]] = { x, y, visibility: 0.99 };
    });
  };
  cad(oE, p.bE, [0.13, 0.12], [11, 13, 15]);
  cad(oD, p.bD, [0.13, 0.12], [12, 14, 16]);
  cad(qE, p.pE, [0.15, 0.15], [23, 25, 27]);
  cad(qD, p.pD, [0.15, 0.15], [24, 26, 28]);
  return A.empacotar(L, t, out, off);
}

// sequência: lista de poses, 1 s cada, com transição de 0,25 s
function gerar(seq, ruido, espelharCorpo = false) {
  const n = seq.length * FPS;
  const fr = new Float32Array(n * A.STRIDE);
  for (let i = 0; i < n; i++) {
    const t = i / FPS;
    const k = Math.floor(t);
    const u = t - k;
    const atual = POSES[seq[k]], prox = POSES[seq[Math.min(seq.length - 1, k + 1)]];
    const p = u > 0.75 ? interp(atual, prox, (u - 0.75) / 0.25) : atual;
    quadro(p, ruido, t, fr, i * A.STRIDE);
    if (espelharCorpo) for (let j = 0; j < 33; j++) fr[i * A.STRIDE + 1 + j * 3] = 1 - fr[i * A.STRIDE + 1 + j * 3];
  }
  return fr;
}

// simula o jogo: você (espelhado pela webcam) chega 'atraso' s depois do vídeo
function jogar(ref, user, atraso, tol) {
  const n = ref.length / A.STRIDE;
  const refT = [], refF = [];
  for (let i = 0; i < n; i++) { refT.push(ref[i * A.STRIDE]); refF.push(A.extrair(ref, i * A.STRIDE, 1, false).f); }
  const pesos = A.pesosDinamicos(refF, refT);
  const janelas = new Map();
  const nU = user.length / A.STRIDE;
  for (let k = 0; k < nU; k++) {
    const tVideo = k / FPS + atraso;
    if (tVideo > refT[n - 1]) break;
    const fu = A.extrair(user, k * A.STRIDE, 1, true).f;
    const melhor = A.melhorNaJanela(fu, refF, refT, pesos, tVideo, 1, tol).nota;
    const j = Math.floor(tVideo);
    const w = janelas.get(j) || { s: 0, c: 0 };
    w.s += melhor; w.c++;
    janelas.set(j, w);
  }
  let pts = 0, q = 0;
  for (const w of janelas.values()) if (w.c >= 3) { pts += A.julgar(w.s / w.c).valor; q++; }
  return pts / q;
}

// "webcam" = imagem espelhada de quem copia como espelho: geramos a pose com o corpo espelhado
// (o jogador levanta o braço do lado oposto do corpo, como num espelho) e a webcam não espelha nada.
const coreo = ['parado', 'cima', 'T', 'esqCima', 'dirCima', 'agacha', 'cintura', 'passoE', 'T', 'cima', 'parado', 'esqCima'];
const ref = gerar(coreo, 2);
const casos = {
  'copia certinho': gerar(coreo, 6, true),
  'copia certinho, ruído forte (12°)': gerar(coreo, 12, true),
  'lado trocado (não espelhou)': gerar(coreo, 6, false),
  'parado o tempo todo': gerar(coreo.map(() => 'parado'), 6, true),
  'braços pra cima o tempo todo': gerar(coreo.map(() => 'cima'), 6, true),
  'coreografia embaralhada': gerar(['agacha', 'parado', 'cintura', 'T', 'passoE', 'cima', 'esqCima', 'dirCima', 'parado', 'agacha', 'T', 'cintura'], 6, true),
};
console.log('pct da nota final (0..1) · Fácil / Normal / Difícil · atraso 0 s e 0,3 s');
for (const [nome, user] of Object.entries(casos)) {
  const linha = [];
  for (const d of ['facil', 'normal', 'dificil']) {
    const tol = A.DIFICULDADES[d].tol;
    linha.push(`${jogar(ref, user, 0, tol).toFixed(2)}/${jogar(ref, user, 0.3, tol).toFixed(2)}`);
  }
  console.log(nome.padEnd(36), linha.join('   '));
}
