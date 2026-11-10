param(
  [Parameter(Mandatory = $true)] [string] $CanopyMain,
  [Parameter(Mandatory = $true)] [string] $CanopyFine,
  [Parameter(Mandatory = $true)] [string] $PlantsAtlas
)

Add-Type -AssemblyName System.Drawing

$outputDir = Join-Path $PSScriptRoot '..\textures-src'
$outputDir = [System.IO.Path]::GetFullPath($outputDir)
[System.IO.Directory]::CreateDirectory($outputDir) | Out-Null

function New-SeamlessMirrorTexture {
  param([string] $InputPath, [string] $OutputPath)

  $source = [System.Drawing.Bitmap]::FromFile($InputPath)
  try {
    $tile = New-Object System.Drawing.Bitmap 1024, 1024, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($tile)
    try {
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($source, 0, 0, 1024, 1024)
    }
    finally { $graphics.Dispose() }

    for ($y = 0; $y -lt $tile.Height; $y++) {
      for ($x = 0; $x -lt $tile.Width; $x++) {
        $pixel = $tile.GetPixel($x, $y)
        $gray = [int][Math]::Round(0.2126 * $pixel.R + 0.7152 * $pixel.G + 0.0722 * $pixel.B)
        $tile.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($gray, $gray, $gray))
      }
    }

    $output = New-Object System.Drawing.Bitmap 2048, 2048, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($output)
    try {
      $graphics.DrawImageUnscaled($tile, 0, 0)

      $flipX = $tile.Clone()
      $flipX.RotateFlip([System.Drawing.RotateFlipType]::RotateNoneFlipX)
      $graphics.DrawImageUnscaled($flipX, 1024, 0)

      $flipY = $tile.Clone()
      $flipY.RotateFlip([System.Drawing.RotateFlipType]::RotateNoneFlipY)
      $graphics.DrawImageUnscaled($flipY, 0, 1024)

      $flipXY = $tile.Clone()
      $flipXY.RotateFlip([System.Drawing.RotateFlipType]::RotateNoneFlipXY)
      $graphics.DrawImageUnscaled($flipXY, 1024, 1024)

      $flipX.Dispose()
      $flipY.Dispose()
      $flipXY.Dispose()
      $output.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
      $graphics.Dispose()
      $output.Dispose()
      $tile.Dispose()
    }
  }
  finally { $source.Dispose() }
}

function New-CleanPlantAtlas {
  param([string] $InputPath, [string] $OutputPath)

  $source = [System.Drawing.Bitmap]::FromFile($InputPath)
  try {
    $clean = New-Object System.Drawing.Bitmap $source.Width, $source.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    for ($y = 0; $y -lt $source.Height; $y++) {
      for ($x = 0; $x -lt $source.Width; $x++) {
        $pixel = $source.GetPixel($x, $y)
        $max = [Math]::Max($pixel.R, [Math]::Max($pixel.G, $pixel.B))
        $min = [Math]::Min($pixel.R, [Math]::Min($pixel.G, $pixel.B))
        $chroma = $max - $min

        $isNeonGreen = $pixel.G -gt 205 -and $pixel.R -lt 105 -and $pixel.B -lt 100 -and $chroma -gt 135
        $isNeonYellow = $pixel.R -gt 205 -and $pixel.G -gt 205 -and $pixel.B -lt 100 -and $chroma -gt 125
        $alpha = if ($isNeonGreen -or $isNeonYellow -or $pixel.A -lt 12) { 0 } else { $pixel.A }
        $clean.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, $pixel.R, $pixel.G, $pixel.B))
      }
    }

    $output = New-Object System.Drawing.Bitmap 2048, 2048, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($output)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($clean, 0, 0, 2048, 2048)
      $output.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
      $graphics.Dispose()
      $output.Dispose()
      $clean.Dispose()
    }
  }
  finally { $source.Dispose() }
}

New-SeamlessMirrorTexture $CanopyMain (Join-Path $outputDir 'canopy_shadow.png')
New-SeamlessMirrorTexture $CanopyFine (Join-Path $outputDir 'canopy_shadow_fine.png')
New-CleanPlantAtlas $PlantsAtlas (Join-Path $outputDir 'groundplants_atlas.png')

