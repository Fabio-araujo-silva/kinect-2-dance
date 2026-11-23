// Processa um vídeo importado: a IA lê a pose do dançarino quadro a quadro e vira a coreografia.
import { criarDetector } from './pose.js';
import { STRIDE, empacotar } from './analise.js';
import { ajustarCanvas, desenharEsqueleto, retanguloContain } from './desenho.js';

export const FPS_ANALISE = 15;

function irPara(video, t) {
  return new Promise((ok) => {
    let feito = false;
    const fim = () => {
      if (feito) return;
      feito = true;
      video.removeEventListener('seeked', fim);
      ok();
    };
    video.addEventListener('seeked', fim);
    setTimeout(fim, 3000); // vídeo travado: segue em frente
    video.currentTime = t;
  });
}

function miniatura(video) {
  const c = document.createElement('canvas');
  const w = 360, h = Math.round(w * video.videoHeight / video.videoWidth) || 640;
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(video, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.75);
}

// video: <video> já com o arquivo carregado (loadedmetadata). canvas: sobreposição da prévia.
export async function processarVideo(video, canvas, { aoProgresso, sinal }) {
  const det = await criarDetector('full');
  try {
    const dur = video.duration;
    const n = Math.max(1, Math.floor(dur * FPS_ANALISE));
    const frames = new Float32Array(n * STRIDE);
    const ctx = canvas.getContext('2d');
    const iThumb = Math.floor(n * 0.3);
    let comCorpo = 0, ts = 0, thumb = null;
    const inicio = performance.now();

    let tempoSalto = 0, tempoIA = 0;
    for (let i = 0; i < n; i++) {
      if (sinal.cancelado) return null;
      const t = Math.min(i / FPS_ANALISE, dur - 0.01);
      const a = performance.now();
      await irPara(video, t);
      const b = performance.now();
      ts = Math.max(ts + 1, Math.round(t * 1000));
      const r = det.detectForVideo(video, ts);
      tempoSalto += b - a; tempoIA += performance.now() - b;
      const lms = r.landmarks && r.landmarks[0];
      empacotar(lms, t, frames, i * STRIDE);
      if (lms) comCorpo++;
      if (i === iThumb) thumb = miniatura(video);

      const dpr = ajustarCanvas(canvas);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (lms) {
        const rect = retanguloContain(canvas.width, canvas.height, video.videoWidth, video.videoHeight);
        desenharEsqueleto(ctx, frames, i * STRIDE, rect, { cor: '#ffd23f', espessura: 4 * dpr });
      }
      const gasto = (performance.now() - inicio) / 1000;
      aoProgresso(i + 1, n, gasto / (i + 1) * (n - i - 1));
    }
    if (!thumb) thumb = miniatura(video);
    console.info(`[passinho] importação: ${n} quadros · saltos ${(tempoSalto / n).toFixed(0)} ms/quadro · IA ${(tempoIA / n).toFixed(0)} ms/quadro`);
    return { frames, comCorpo, n, thumb };
  } finally {
    det.close();
  }
}
