# Achica una foto al tamaño de la pantalla (ej. 4K → 1920×1080) con el mejor escalado de Windows y la
# guarda como JPEG de alta calidad. Lo usan los fondos: así Edge carga y dibuja la cuarta parte de
# píxeles, pero más nítida que la versión de 1080p que da Bing (que viene muy comprimida).
# Uso: resize-image.ps1 -In foto-4k.jpg -Out foto-1080.jpg -Width 1920 -Height 1080 [-Quality 92]
param(
    [Parameter(Mandatory = $true)][string]$In,
    [Parameter(Mandatory = $true)][string]$Out,
    [int]$Width = 1920,
    [int]$Height = 1080,
    [int]$Quality = 92
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$source = [System.Drawing.Image]::FromFile($In)
try {
    # "Cubrir" como en la pantalla: se escala hasta llenar y se recorta lo que sobra, centrado.
    $scale = [Math]::Max($Width / $source.Width, $Height / $source.Height)
    $srcW = [int][Math]::Round($Width / $scale)
    $srcH = [int][Math]::Round($Height / $scale)
    $srcX = [int](($source.Width - $srcW) / 2)
    $srcY = [int](($source.Height - $srcH) / 2)

    $target = New-Object System.Drawing.Bitmap $Width, $Height
    try {
        $g = [System.Drawing.Graphics]::FromImage($target)
        try {
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            # Sin esto, el borde de la imagen sale con una línea más clara.
            $attributes = New-Object System.Drawing.Imaging.ImageAttributes
            $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
            $g.DrawImage($source, (New-Object System.Drawing.Rectangle 0, 0, $Width, $Height), $srcX, $srcY, $srcW, $srcH, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
        } finally { $g.Dispose() }

        $jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
        $params = New-Object System.Drawing.Imaging.EncoderParameters 1
        $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$Quality)
        $target.Save($Out, $jpeg, $params)
    } finally { $target.Dispose() }
} finally { $source.Dispose() }
