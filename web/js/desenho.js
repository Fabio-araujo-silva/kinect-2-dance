// Desenho de esqueletos nos canvas.
import { ponto } from './analise.js';

const LIGACOES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32], [15, 19], [16, 20],
];
const VIS = 0.5;

export function corNota(s) {
  if (s < 0) return 'rgba(255,255,255,0.35)';
  return `hsl(${Math.round(s * 120)}, 95%, 55%)`;
}

// Retângulo onde o vídeo aparece dentro do elemento (object-fit: contain)
export function retanguloContain(larguraEl, alturaEl, larguraVid, alturaVid) {
  if (!larguraVid || !alturaVid) return { x: 0, y: 0, w: larguraEl, h: alturaEl };
  const esc = Math.min(larguraEl / larguraVid, alturaEl / alturaVid);
  const w = larguraVid * esc, h = alturaVid * esc;
  return { x: (larguraEl - w) / 2, y: (alturaEl - h) / 2, w, h };
}

export function ajustarCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return dpr;
}

// arr/off: quadro empacotado; rect em pixels do canvas; espelhar: inverte x
// cores: Map "a-b" -> cor (opcional)
export function desenharEsqueleto(ctx, arr, off, rect, { espelhar = false, cor = '#fff', espessura = 4, cores = null, juntas = true } = {}) {
  const px = (i) => {
    const b = off + 1 + i * 3;
    const x = espelhar ? 1 - arr[b] : arr[b];
    return [rect.x + x * rect.w, rect.y + arr[b + 1] * rect.h, arr[b + 2]];
  };
  ctx.lineCap = 'round';
  ctx.lineWidth = espessura;
  for (const [a, b] of LIGACOES) {
    const pa = px(a), pb = px(b);
    if (pa[2] < VIS || pb[2] < VIS) continue;
    ctx.strokeStyle = (cores && (cores.get(`${a}-${b}`) || cores.get(`${b}-${a}`))) || cor;
    ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
  }
  if (juntas) {
    ctx.fillStyle = cor;
    for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const p = px(i);
      if (p[2] < VIS) continue;
      ctx.beginPath(); ctx.arc(p[0], p[1], espessura * (i === 0 ? 2.2 : 0.9), 0, Math.PI * 2); ctx.fill();
    }
  }
}

// Mapa de cores por ligação a partir da nota de cada segmento
export function coresPorSegmento(pares, porSeg) {
  const m = new Map();
  pares.forEach((par, k) => {
    if (par === 'tronco') {
      const c = corNota(porSeg[k]);
      for (const l of ['11-23', '12-24', '11-12', '23-24']) m.set(l, c);
    } else {
      m.set(`${par[0]}-${par[1]}`, corNota(porSeg[k]));
    }
  });
  return m;
}

// "Fantasma": seu esqueleto desenhado por cima do dançarino, alinhado no quadril e na altura do tronco
export function desenharFantasma(ctx, userArr, aspUser, refArr, refOff, aspRef, rect, cor, espessura) {
  const centro = (arr, off, asp, esp) => {
    const oE = ponto(arr, off, 11, asp, esp), oD = ponto(arr, off, 12, asp, esp);
    const qE = ponto(arr, off, 23, asp, esp), qD = ponto(arr, off, 24, asp, esp);
    if (Math.min(oE[2], oD[2], qE[2], qD[2]) < VIS) return null;
    const q = [(qE[0] + qD[0]) / 2, (qE[1] + qD[1]) / 2];
    const o = [(oE[0] + oD[0]) / 2, (oE[1] + oD[1]) / 2];
    return { q, tam: Math.hypot(o[0] - q[0], o[1] - q[1]) };
  };
  const cu = centro(userArr, 0, aspUser, true), cr = centro(refArr, refOff, aspRef, false);
  if (!cu || !cr || cu.tam < 1e-3) return;
  const esc = cr.tam / cu.tam;
  const P = (i) => {
    const p = ponto(userArr, 0, i, aspUser, true);
    const x = cr.q[0] + (p[0] - cu.q[0]) * esc, y = cr.q[1] + (p[1] - cu.q[1]) * esc;
    return [rect.x + (x / aspRef) * rect.w, rect.y + y * rect.h, p[2]];
  };
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.lineCap = 'round';
  ctx.lineWidth = espessura;
  ctx.strokeStyle = cor;
  ctx.setLineDash([espessura * 1.5, espessura * 1.2]);
  for (const [a, b] of LIGACOES) {
    const pa = P(a), pb = P(b);
    if (pa[2] < VIS || pb[2] < VIS) continue;
    ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
  }
  ctx.restore();
}
