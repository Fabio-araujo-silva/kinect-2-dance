// Compara a sua pose com a do dançarino.
//
// Ideia: em vez de comparar posições (que dependem de onde você está na sala e do
// tamanho do corpo), comparamos a DIREÇÃO de cada parte do corpo — braço, antebraço,
// coxa, canela e tronco — na tela. Duas pessoas de tamanhos diferentes fazendo o mesmo
// movimento têm as mesmas direções.
//
// Lados: os braços/pernas são separados pelo lado da TELA (quem está mais à esquerda),
// não pelo rótulo esquerdo/direito do corpo. Com a webcam espelhada isso faz você copiar
// o que vê, tanto com o dançarino de frente (modo espelho) quanto de costas.

export const STRIDE = 100; // por quadro: t + 33 pontos * (x, y, visibilidade)
export const NSEG = 9;
const VIS_MIN = 0.5;

// peso de cada parte na nota
export const SEGMENTOS = [
  { nome: 'braço (esq. da tela)', peso: 1.0 },
  { nome: 'antebraço (esq. da tela)', peso: 1.0 },
  { nome: 'braço (dir. da tela)', peso: 1.0 },
  { nome: 'antebraço (dir. da tela)', peso: 1.0 },
  { nome: 'coxa (esq. da tela)', peso: 0.7 },
  { nome: 'canela (esq. da tela)', peso: 0.6 },
  { nome: 'coxa (dir. da tela)', peso: 0.7 },
  { nome: 'canela (dir. da tela)', peso: 0.6 },
  { nome: 'tronco', peso: 0.6 },
];
const PERNAS = new Set([4, 5, 6, 7]);

const BRACO_E = [11, 13, 15], BRACO_D = [12, 14, 16];
const PERNA_E = [23, 25, 27], PERNA_D = [24, 26, 28];

export function empacotar(lms, t, out = new Float32Array(STRIDE), off = 0) {
  out[off] = t;
  for (let i = 0; i < 33; i++) {
    const l = lms ? lms[i] : null;
    const b = off + 1 + i * 3;
    if (l) { out[b] = l.x; out[b + 1] = l.y; out[b + 2] = l.visibility ?? 1; }
    else { out[b] = 0; out[b + 1] = 0; out[b + 2] = 0; }
  }
  return out;
}

// ponto i em "unidades de aspecto": x multiplicado pela proporção da imagem, pra ângulos certos
export function ponto(arr, off, i, aspecto, espelhar) {
  const b = off + 1 + i * 3;
  const x = espelhar ? 1 - arr[b] : arr[b];
  return [x * aspecto, arr[b + 1], arr[b + 2]];
}

function meio(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.min(a[2], b[2])]; }

// Retorna { f: Float32Array(NSEG*3) [dx, dy, visível], pares: [[a,b]...] por segmento (índices de landmark ou 'tronco') }
export function extrair(arr, off, aspecto, espelhar) {
  const P = (i) => ponto(arr, off, i, aspecto, espelhar);
  const oE = P(11), oD = P(12), qE = P(23), qD = P(24);
  const bTE = oE[0] <= oD[0] ? BRACO_E : BRACO_D;
  const bTD = bTE === BRACO_E ? BRACO_D : BRACO_E;
  const pTE = qE[0] <= qD[0] ? PERNA_E : PERNA_D;
  const pTD = pTE === PERNA_E ? PERNA_D : PERNA_E;

  const f = new Float32Array(NSEG * 3);
  const seg = (k, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const n = Math.hypot(dx, dy);
    if (n < 1e-5) { f[k * 3 + 2] = 0; return; }
    f[k * 3] = dx / n; f[k * 3 + 1] = dy / n;
    f[k * 3 + 2] = Math.min(a[2], b[2]) >= VIS_MIN ? 1 : 0;
  };
  const pares = [
    [bTE[0], bTE[1]], [bTE[1], bTE[2]], [bTD[0], bTD[1]], [bTD[1], bTD[2]],
    [pTE[0], pTE[1]], [pTE[1], pTE[2]], [pTD[0], pTD[1]], [pTD[1], pTD[2]],
  ];
  pares.forEach(([a, b], k) => seg(k, P(a), P(b)));
  seg(8, meio(oE, oD), meio(qE, qD));
  pares.push('tronco');
  return { f, pares };
}

export function temCorpo(f) {
  // tronco + pelo menos um braço visíveis
  return f[8 * 3 + 2] > 0 && (f[0 * 3 + 2] > 0 || f[2 * 3 + 2] > 0);
}

export function quadroVazio(f) {
  for (let k = 0; k < NSEG; k++) if (f[k * 3 + 2] > 0) return false;
  return true;
}

function anguloEntre(a, b, k) {
  const c = Math.max(-1, Math.min(1, a[k * 3] * b[k * 3] + a[k * 3 + 1] * b[k * 3 + 1]));
  return Math.acos(c) * 180 / Math.PI;
}

// Peso de cada parte em cada quadro da coreografia, conforme o quanto ela se MEXE ali.
// Sem isso, ficar parado em pé já garante metade da nota (pernas e tronco quase sempre batem).
// Parte parada vale 30% do peso; parte que gira 35°+ em ±0,4 s vale 100%.
export function pesosDinamicos(refF, refT) {
  const n = refF.length;
  const pesos = new Array(n);
  const RAIO = 0.4, GIRO_CHEIO = 35, BASE = 0.3;
  for (let i = 0; i < n; i++) {
    const a = limiteInferior(refT, refT[i] - RAIO);
    const b = Math.min(n - 1, limiteInferior(refT, refT[i] + RAIO));
    const w = new Float32Array(NSEG);
    for (let k = 0; k < NSEG; k++) {
      let mov = 0;
      if (refF[i][k * 3 + 2]) {
        for (const j of [a, b]) if (j !== i && refF[j][k * 3 + 2]) mov = Math.max(mov, anguloEntre(refF[i], refF[j], k));
      }
      w[k] = SEGMENTOS[k].peso * (BASE + (1 - BASE) * Math.min(1, mov / GIRO_CHEIO));
    }
    pesos[i] = w;
  }
  return pesos;
}

// tolGraus: erro de ângulo em que a parte zera (fácil 80, normal 62, difícil 45)
// porSeg (opcional): recebe a nota 0..1 de cada parte, ou -1 se não conta
// pesos (opcional): Float32Array(NSEG) de pesosDinamicos; sem ele usa o peso fixo
// Retorna 0..1, ou -1 se a referência não tem corpo nesse quadro.
export function comparar(fu, fr, tolGraus, porSeg, pesos) {
  const LIVRE = 12; // até 12° de diferença é nota cheia
  let soma = 0, total = 0;
  for (let k = 0; k < NSEG; k++) {
    if (!fr[k * 3 + 2]) { if (porSeg) porSeg[k] = -1; continue; }
    let s;
    if (!fu[k * 3 + 2]) {
      // perna fora da câmera não penaliza (sala pequena); braço sumido conta zero
      if (PERNAS.has(k)) { if (porSeg) porSeg[k] = -1; continue; }
      s = 0;
    } else {
      const erro = anguloEntre(fu, fr, k);
      s = Math.max(0, Math.min(1, 1 - (erro - LIVRE) / (tolGraus - LIVRE)));
    }
    const p = pesos ? pesos[k] : SEGMENTOS[k].peso;
    soma += s * p; total += p;
    if (porSeg) porSeg[k] = s;
  }
  return total > 0 ? soma / total : -1;
}

// Você reage com um pouco de atraso ao vídeo. Procura, entre as poses da coreografia
// um pouco antes e um pouco depois do instante atual, a que mais bate com a sua.
// Chegar atrasado ainda vale, mas perde um pouco: até 0,1 s de graça, 0,4 s custa ~25%.
// rate: velocidade do vídeo (atrasos são medidos em tempo real, não do vídeo).
export function melhorNaJanela(fu, refF, refT, refP, tVideo, rate, tol) {
  const atrasoMax = Math.max(0.4 * rate, 0.12);
  const adiantoMax = Math.max(0.12 * rate, 0.06);
  let nota = -1, idx = -1;
  for (let i = limiteInferior(refT, tVideo - atrasoMax); i < refF.length && refT[i] <= tVideo + adiantoMax; i++) {
    let s = comparar(fu, refF[i], tol, null, refP ? refP[i] : null);
    if (s < 0) continue;
    const atraso = (tVideo - refT[i]) / rate;
    s *= 1 - 0.3 * Math.max(0, Math.min(1, (atraso - 0.1) / 0.4));
    if (s > nota) { nota = s; idx = i; }
  }
  return { nota, idx };
}

export const DIFICULDADES = {
  facil: { nome: 'Fácil', tol: 80 },
  normal: { nome: 'Normal', tol: 62 },
  dificil: { nome: 'Difícil', tol: 45 },
};

export const JULGAMENTOS = [
  { min: 0.85, nome: 'PERFEITO!', valor: 1.0, cor: '#ffd23f', chave: 'perfeito' },
  { min: 0.72, nome: 'ÓTIMO', valor: 0.8, cor: '#3ee07f', chave: 'otimo' },
  { min: 0.58, nome: 'BOM', valor: 0.55, cor: '#3ec5ff', chave: 'bom' },
  { min: 0.42, nome: 'OK', valor: 0.3, cor: '#b98cff', chave: 'ok' },
  { min: -1, nome: 'ERROU', valor: 0, cor: '#ff4d6d', chave: 'errou' },
];
export function julgar(media) {
  return JULGAMENTOS.find((j) => media >= j.min);
}

export function estrelas(pct) {
  if (pct >= 0.9) return 5;
  if (pct >= 0.78) return 4;
  if (pct >= 0.62) return 3;
  if (pct >= 0.45) return 2;
  if (pct >= 0.25) return 1;
  return 0;
}

// primeiro índice com t >= alvo
export function limiteInferior(ts, alvo) {
  let lo = 0, hi = ts.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] < alvo) lo = m + 1; else hi = m; }
  return lo;
}
