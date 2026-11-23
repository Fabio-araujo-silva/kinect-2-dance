# kinect-2-dance · passinho.

Jogo de dança que aprende a coreografia de **qualquer vídeo**: você importa um vídeo (TikTok, Reels, YouTube, aula de forró…), a IA lê os movimentos do dançarino quadro a quadro e depois você dança na frente da webcam valendo nota, combo e estrelas.

- **Zero instalação no Windows 10/11.** Só usa o Edge (ou Chrome) e o PowerShell, que já vêm no sistema. Nada de Python, Node ou runtime.
- **Offline e privado.** A IA de pose (MediaPipe, em WebAssembly) vem dentro da pasta. O vídeo e a sua câmera nunca saem do computador.
- **Pra aprender, não só pra jogar.** Velocidade 0,5x / 0,75x, um "fantasma" com o seu esqueleto por cima do dançarino, partes do corpo pintadas de verde/vermelho na hora e um botão que manda **treinar em loop o trecho em que você mais errou**.

## Como usar

1. Baixe o repositório (Code → Download ZIP) e extraia.
2. Dê dois cliques em **`Passinho.bat`**. O navegador abre em `http://localhost:4949`.
3. **Importar vídeo** → **Processar com a IA** (leva mais ou menos o tempo do vídeo, depende do PC).
4. **Dançar**: fique uns 2 m da câmera, com ombros e quadril aparecendo, e copie como num espelho.

Teclas durante o jogo: `espaço` pausa · `esc` pausa/sai.

Funciona melhor com **um dançarino só, de corpo inteiro e câmera parada**. Vídeo `.mov` de iPhone (HEVC) pode não abrir no navegador; converta pra MP4 (H.264).

## Como a nota funciona

1. **Importação:** o modelo `pose_landmarker_full` lê 33 pontos do corpo a 15 quadros por segundo e salva a coreografia no navegador (IndexedDB).
2. **Ao vivo:** o modelo `lite` lê você pela webcam. Comparamos a **direção** de 9 partes do corpo (braços, antebraços, coxas, canelas e tronco), e não a posição. Assim, altura, distância da câmera e lugar na sala não importam.
3. **Espelho:** braços e pernas são pareados pelo lado da *tela*, e não pelo rótulo esquerdo/direito. Você copia o que vê, com o dançarino de frente ou de costas.
4. **O que mexe vale mais:** o peso de cada parte acompanha o quanto ela se move na coreografia naquele instante. Sem isso, ficar parado em pé já garantiria metade da nota.
5. **Atraso humano:** a gente procura a melhor pose entre 0,4 s antes e 0,12 s depois do instante atual. Chegar atrasado vale, mas perde um pouco.
6. A cada 1 s de vídeo sai um julgamento (PERFEITO · ÓTIMO · BOM · OK · ERROU). A nota final vai de 0 a 10.000.

Teste da pontuação com uma coreografia sintética (precisa de Node só pra rodar o teste):

```
node testes/pontuacao.mjs
```

| caso (dificuldade Normal) | nota |
|---|---|
| copia certinho | 1,00 |
| lado trocado (não espelhou) | 0,80 |
| parado o tempo todo | 0,47 |
| braços pra cima o tempo todo | 0,36 |
| coreografia embaralhada | 0,20 |

## Estrutura

```
Passinho.bat          atalho: sobe o servidor e abre o navegador
servidor.ps1          servidor HTTP local em PowerShell puro (porta 4949, ou a próxima livre)
web/index.html        telas: biblioteca, importação, jogo, resultado
web/js/analise.js     extração das partes do corpo, comparação, pesos e julgamento
web/js/jogo.js        a partida: webcam + vídeo + placar + treino em loop
web/js/importar.js    lê o vídeo importado quadro a quadro com a IA
web/js/desenho.js     esqueletos, fantasma, cores
web/js/banco.js       IndexedDB (vídeos, coreografias, recordes)
web/vendor/           MediaPipe Tasks Vision 1.2.3 (Apache-2.0)
web/modelos/          modelos de pose lite e full do MediaPipe (Apache-2.0)
testes/pontuacao.mjs  validação da nota com coreografia sintética
```

## E o Kinect?

Por enquanto funciona com **webcam**. O próximo passo é ler o esqueleto de um Kinect (v1 com `libfreenect`, v2 com `libfreenect2`). A profundidade deixa o rastreamento mais estável no escuro e permite comparar movimentos em 3D. A leitura do corpo já é isolada (`pose.js` + `analise.js`), então o Kinect entra como mais uma fonte de pontos.

## Créditos

- [MediaPipe](https://github.com/google-ai-edge/mediapipe) (Google), licença Apache-2.0: IA de pose e modelos incluídos em `web/vendor` e `web/modelos`.
