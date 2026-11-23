// Carrega a IA de pose (MediaPipe) a partir dos arquivos locais da pasta vendor/.
import { FilesetResolver, PoseLandmarker } from '../vendor/vision_bundle.mjs';

let fileset;
async function obterFileset() {
  if (!fileset) fileset = await FilesetResolver.forVisionTasks(new URL('../vendor/wasm', import.meta.url).href);
  return fileset;
}

// tipo: 'lite' (rapido, pra webcam ao vivo) ou 'full' (mais preciso, pra processar o video importado)
export async function criarDetector(tipo) {
  const fs = await obterFileset();
  const modelo = new URL(`../modelos/pose_${tipo}.task`, import.meta.url).href;
  let ultimoErro;
  for (const delegate of ['GPU', 'CPU']) {
    try {
      const det = await PoseLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: modelo, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      console.info(`[passinho] IA de pose (${tipo}) carregada via ${delegate}`);
      return det;
    } catch (e) {
      ultimoErro = e;
      console.warn(`[passinho] ${delegate} falhou para ${tipo}:`, e);
    }
  }
  throw new Error('Não consegui carregar a IA de pose: ' + (ultimoErro?.message || ultimoErro));
}

// Detector ao vivo compartilhado (timestamps precisam ser sempre crescentes por instância).
let vivo, ultimoTs = 0;
export async function detectorAoVivo() {
  if (!vivo) vivo = criarDetector('lite').catch((e) => { vivo = null; throw e; });
  return vivo;
}
export function tsCrescente(agora) {
  ultimoTs = Math.max(ultimoTs + 1, Math.round(agora));
  return ultimoTs;
}
