# Passinho - servidor local minimo (so PowerShell, nada pra instalar).
# Serve a pasta web/ em http://localhost:4949/ e abre o navegador.
param([int]$Porta = 4949)

$ErrorActionPreference = 'Stop'
$raiz = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'web')) + [IO.Path]::DirectorySeparatorChar

$mimes = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.wasm' = 'application/wasm'
  '.task' = 'application/octet-stream'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
}

$http = $null
for ($p = $Porta; $p -lt ($Porta + 20); $p++) {
  $h = New-Object System.Net.HttpListener
  $h.Prefixes.Add("http://localhost:$p/")
  try { $h.Start(); $http = $h; $Porta = $p; break } catch { $h.Close() }
}
if (-not $http) {
  Write-Host "Nao consegui abrir nenhuma porta entre $Porta e $($Porta + 19)." -ForegroundColor Red
  exit 1
}

$url = "http://localhost:$Porta/"
Write-Host ''
Write-Host '  PASSINHO rodando em' -NoNewline
Write-Host " $url" -ForegroundColor Magenta
Write-Host '  Feche esta janela para desligar.'
Write-Host ''
if (-not $env:PASSINHO_SEM_NAVEGADOR) { Start-Process $url }

try {
  while ($http.IsListening) {
    $tarefa = $http.GetContextAsync()
    while (-not $tarefa.AsyncWaitHandle.WaitOne(250)) { }   # deixa o Ctrl+C funcionar
    $ctx = $tarefa.GetAwaiter().GetResult()
    $resp = $ctx.Response
    try {
      $caminho = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
      if ($caminho -eq '/') { $caminho = '/index.html' }
      $arq = [IO.Path]::GetFullPath((Join-Path $raiz $caminho.TrimStart('/')))
      if (-not $arq.StartsWith($raiz, [StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($arq)) {
        $resp.StatusCode = 404
      } else {
        $ext = [IO.Path]::GetExtension($arq).ToLowerInvariant()
        $tipo = $mimes[$ext]
        if (-not $tipo) { $tipo = 'application/octet-stream' }
        $resp.ContentType = $tipo
        $resp.Headers['Cache-Control'] = 'no-cache'
        $fs = [IO.File]::OpenRead($arq)
        try { $resp.ContentLength64 = $fs.Length; $fs.CopyTo($resp.OutputStream) } finally { $fs.Close() }
      }
    } catch {
      # cliente fechou a conexao no meio; segue o baile
    } finally {
      try { $resp.OutputStream.Close() } catch { }
    }
  }
} finally {
  $http.Stop()
  $http.Close()
}
