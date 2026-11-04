[CmdletBinding(SupportsShouldProcess)]
param([int]$Port = 8766)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'site'))
if (-not $PSCmdlet.ShouldProcess("http://127.0.0.1:$Port/", 'Serve generated architecture site only on loopback')) { return }
$listener = [Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        try {
            $relative = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart('/')
            if (-not $relative) { $relative = 'index.html' }
            $path = [IO.Path]::GetFullPath((Join-Path $root $relative))
            if (-not $path.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
                $context.Response.StatusCode = 404
            } else {
                $context.Response.ContentType = switch ([IO.Path]::GetExtension($path)) { '.html' {'text/html; charset=utf-8'} '.js' {'text/javascript; charset=utf-8'} '.css' {'text/css; charset=utf-8'} '.svg' {'image/svg+xml'} '.png' {'image/png'} '.woff2' {'font/woff2'} default {'application/octet-stream'} }
                $bytes = [IO.File]::ReadAllBytes($path)
                $context.Response.ContentLength64 = $bytes.Length
                $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        } finally { $context.Response.Close() }
    }
} finally { $listener.Stop(); $listener.Close() }
