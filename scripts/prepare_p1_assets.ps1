param(
  [string] $Pebbles,
  [string] $Leaves,
  [string] $FoxStone,
  [string] $Ripples,
  [string] $CanopyMain,
  [string] $CanopyFine,
  [string] $MossGrass,
  [string] $RockMossyA,
  [string] $RockMossyB,
  [string] $RockLichen,
  [string] $Caustics,
  [string] $ShoreMud,
  [string] $ColorReference,
  [string] $BroadleafAtlas,
  [string] $WhiteFlowerAtlas,
  [string] $WetRockHeight,
  [string] $NightReference,
  [string] $LeafVeins,
  [string] $NightPanorama,
  [string] $RippleRings
)

Add-Type -AssemblyName System.Drawing

if (-not ('WishAssetTools' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class WishAssetTools {
  static Bitmap Resize(Bitmap src, int width, int height, PixelFormat format) {
    Bitmap dst = new Bitmap(width, height, format);
    using (Graphics g = Graphics.FromImage(dst)) {
      g.Clear(Color.Transparent);
      g.CompositingMode = CompositingMode.SourceCopy;
      g.CompositingQuality = CompositingQuality.HighQuality;
      g.InterpolationMode = InterpolationMode.HighQualityBicubic;
      g.PixelOffsetMode = PixelOffsetMode.HighQuality;
      g.DrawImage(src, 0, 0, width, height);
    }
    return dst;
  }

  public static Bitmap SeamlessMirror(string path, int size) {
    using (Bitmap src = new Bitmap(path)) {
      int half = size / 2;
      using (Bitmap tile = Resize(src, half, half, PixelFormat.Format24bppRgb)) {
        Bitmap output = new Bitmap(size, size, PixelFormat.Format24bppRgb);
        using (Graphics g = Graphics.FromImage(output)) {
          g.DrawImageUnscaled(tile, 0, 0);
          using (Bitmap flipX = (Bitmap)tile.Clone()) {
            flipX.RotateFlip(RotateFlipType.RotateNoneFlipX);
            g.DrawImageUnscaled(flipX, half, 0);
          }
          using (Bitmap flipY = (Bitmap)tile.Clone()) {
            flipY.RotateFlip(RotateFlipType.RotateNoneFlipY);
            g.DrawImageUnscaled(flipY, 0, half);
          }
          using (Bitmap flipXY = (Bitmap)tile.Clone()) {
            flipXY.RotateFlip(RotateFlipType.RotateNoneFlipXY);
            g.DrawImageUnscaled(flipXY, half, half);
          }
        }
        return output;
      }
    }
  }

  static byte[] ReadBgra(Bitmap bitmap, out int stride) {
    Rectangle rect = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
    BitmapData data = bitmap.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    stride = Math.Abs(data.Stride);
    byte[] pixels = new byte[stride * bitmap.Height];
    Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
    bitmap.UnlockBits(data);
    return pixels;
  }

  static Bitmap ToArgb(Bitmap src) {
    return Resize(src, src.Width, src.Height, PixelFormat.Format32bppArgb);
  }

  static int Luma(byte[] pixels, int stride, int width, int height, int x, int y) {
    x = (x % width + width) % width;
    y = (y % height + height) % height;
    int i = y * stride + x * 4;
    return (int)Math.Round(0.0722 * pixels[i] + 0.7152 * pixels[i + 1] + 0.2126 * pixels[i + 2]);
  }

  public static Bitmap NormalFromHeight(Bitmap source, double strength) {
    using (Bitmap src = ToArgb(source)) {
      int stride;
      byte[] input = ReadBgra(src, out stride);
      Bitmap output = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
      Rectangle rect = new Rectangle(0, 0, output.Width, output.Height);
      BitmapData data = output.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
      int outStride = Math.Abs(data.Stride);
      byte[] result = new byte[outStride * output.Height];
      for (int y = 0; y < output.Height; y++) {
        for (int x = 0; x < output.Width; x++) {
          double nx = (Luma(input, stride, output.Width, output.Height, x - 1, y) - Luma(input, stride, output.Width, output.Height, x + 1, y)) / 255.0 * strength;
          double ny = (Luma(input, stride, output.Width, output.Height, x, y + 1) - Luma(input, stride, output.Width, output.Height, x, y - 1)) / 255.0 * strength;
          double nz = 1.0;
          double length = Math.Sqrt(nx * nx + ny * ny + nz * nz);
          nx /= length; ny /= length; nz /= length;
          int i = y * outStride + x * 4;
          result[i] = (byte)Math.Round((nz * 0.5 + 0.5) * 255.0);
          result[i + 1] = (byte)Math.Round((ny * 0.5 + 0.5) * 255.0);
          result[i + 2] = (byte)Math.Round((nx * 0.5 + 0.5) * 255.0);
          result[i + 3] = 255;
        }
      }
      Marshal.Copy(result, 0, data.Scan0, result.Length);
      output.UnlockBits(data);
      return output;
    }
  }

  public static Bitmap PeriodicBlend(string path, int size, int band) {
    using (Bitmap original = new Bitmap(path))
    using (Bitmap src = Resize(original, size, size, PixelFormat.Format32bppArgb)) {
      int stride;
      byte[] pixels = ReadBgra(src, out stride);
      for (int d = 0; d < band; d++) {
        double u = 1.0 - d / (double)band;
        double weight = u * u * (3.0 - 2.0 * u);
        int left = d, right = size - 1 - d;
        for (int y = 0; y < size; y++) {
          int a = y * stride + left * 4, b = y * stride + right * 4;
          for (int c = 0; c < 3; c++) {
            int average = (pixels[a + c] + pixels[b + c]) / 2;
            pixels[a + c] = (byte)Math.Round(pixels[a + c] * (1.0 - weight) + average * weight);
            pixels[b + c] = (byte)Math.Round(pixels[b + c] * (1.0 - weight) + average * weight);
          }
        }
      }
      for (int d = 0; d < band; d++) {
        double u = 1.0 - d / (double)band;
        double weight = u * u * (3.0 - 2.0 * u);
        int top = d, bottom = size - 1 - d;
        for (int x = 0; x < size; x++) {
          int a = top * stride + x * 4, b = bottom * stride + x * 4;
          for (int c = 0; c < 3; c++) {
            int average = (pixels[a + c] + pixels[b + c]) / 2;
            pixels[a + c] = (byte)Math.Round(pixels[a + c] * (1.0 - weight) + average * weight);
            pixels[b + c] = (byte)Math.Round(pixels[b + c] * (1.0 - weight) + average * weight);
          }
        }
      }
      for (int y = 0; y < size; y++)
        for (int x = 0; x < size; x++)
          pixels[y * stride + x * 4 + 3] = 255;
      Bitmap output = new Bitmap(size, size, PixelFormat.Format32bppArgb);
      Rectangle rect = new Rectangle(0, 0, size, size);
      BitmapData data = output.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
      Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
      output.UnlockBits(data);
      return output;
    }
  }

  public static Bitmap EqualizeEdges(Bitmap bitmap) {
    int maxX = bitmap.Width - 1, maxY = bitmap.Height - 1;
    for (int y = 0; y < bitmap.Height; y++) {
      Color a = bitmap.GetPixel(0, y), b = bitmap.GetPixel(maxX, y);
      Color average = Color.FromArgb(255, (a.R + b.R) / 2, (a.G + b.G) / 2, (a.B + b.B) / 2);
      bitmap.SetPixel(0, y, average);
      bitmap.SetPixel(maxX, y, average);
    }
    for (int x = 0; x < bitmap.Width; x++) {
      Color a = bitmap.GetPixel(x, 0), b = bitmap.GetPixel(x, maxY);
      Color average = Color.FromArgb(255, (a.R + b.R) / 2, (a.G + b.G) / 2, (a.B + b.B) / 2);
      bitmap.SetPixel(x, 0, average);
      bitmap.SetPixel(x, maxY, average);
    }
    return bitmap;
  }

  public static Bitmap BalancedMask(string path, int size, int band, double darkFraction) {
    using (Bitmap periodic = PeriodicBlend(path, size, band))
    using (Bitmap src = ToArgb(periodic)) {
      int stride;
      byte[] pixels = ReadBgra(src, out stride);
      int[] histogram = new int[256];
      for (int y = 0; y < size; y++)
        for (int x = 0; x < size; x++)
          histogram[Luma(pixels, stride, size, size, x, y)]++;
      int target = (int)Math.Round(size * size * darkFraction);
      int cumulative = 0, threshold = 128;
      for (int i = 0; i < 256; i++) {
        cumulative += histogram[i];
        if (cumulative >= target) { threshold = i; break; }
      }
      int low = threshold - 18, high = threshold + 18;
      for (int y = 0; y < size; y++) {
        for (int x = 0; x < size; x++) {
          int p = y * stride + x * 4;
          int luma = Luma(pixels, stride, size, size, x, y);
          int gray = luma <= low ? 0 : (luma >= high ? 255 : (luma - low) * 255 / (high - low));
          pixels[p] = pixels[p + 1] = pixels[p + 2] = (byte)gray;
          pixels[p + 3] = 255;
        }
      }
      Bitmap output = new Bitmap(size, size, PixelFormat.Format32bppArgb);
      Rectangle rect = new Rectangle(0, 0, size, size);
      BitmapData data = output.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
      Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
      output.UnlockBits(data);
      return EqualizeEdges(output);
    }
  }

  public static Bitmap GrayscaleTexture(string path, int size, int band) {
    using (Bitmap periodic = PeriodicBlend(path, size, band))
    using (Bitmap src = ToArgb(periodic)) {
      int stride;
      byte[] pixels = ReadBgra(src, out stride);
      for (int y = 0; y < size; y++) {
        for (int x = 0; x < size; x++) {
          int p = y * stride + x * 4;
          byte gray = (byte)Luma(pixels, stride, size, size, x, y);
          pixels[p] = pixels[p + 1] = pixels[p + 2] = gray;
          pixels[p + 3] = 255;
        }
      }
      Bitmap output = new Bitmap(size, size, PixelFormat.Format32bppArgb);
      Rectangle rect = new Rectangle(0, 0, size, size);
      BitmapData data = output.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
      Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
      output.UnlockBits(data);
      return EqualizeEdges(output);
    }
  }

  public static Bitmap CenterCropResize(string path, int width, int height) {
    using (Bitmap src = new Bitmap(path)) {
      double sourceAspect = src.Width / (double)src.Height;
      double targetAspect = width / (double)height;
      Rectangle crop;
      if (sourceAspect > targetAspect) {
        int cropWidth = (int)Math.Round(src.Height * targetAspect);
        crop = new Rectangle((src.Width - cropWidth) / 2, 0, cropWidth, src.Height);
      } else {
        int cropHeight = (int)Math.Round(src.Width / targetAspect);
        crop = new Rectangle(0, (src.Height - cropHeight) / 2, src.Width, cropHeight);
      }
      Bitmap output = new Bitmap(width, height, PixelFormat.Format24bppRgb);
      using (Graphics g = Graphics.FromImage(output)) {
        g.CompositingQuality = CompositingQuality.HighQuality;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.DrawImage(src, new Rectangle(0, 0, width, height), crop, GraphicsUnit.Pixel);
      }
      return output;
    }
  }

  public static Bitmap HorizontalPanorama(string path, int width, int height, int band) {
    using (Bitmap resized = CenterCropResize(path, width, height))
    using (Bitmap src = ToArgb(resized)) {
      int stride;
      byte[] pixels = ReadBgra(src, out stride);
      for (int d = 0; d < band; d++) {
        double u = 1.0 - d / (double)band;
        double weight = u * u * (3.0 - 2.0 * u);
        int left = d, right = width - 1 - d;
        for (int y = 0; y < height; y++) {
          int a = y * stride + left * 4, b = y * stride + right * 4;
          for (int c = 0; c < 3; c++) {
            int average = (pixels[a + c] + pixels[b + c]) / 2;
            pixels[a + c] = (byte)Math.Round(pixels[a + c] * (1.0 - weight) + average * weight);
            pixels[b + c] = (byte)Math.Round(pixels[b + c] * (1.0 - weight) + average * weight);
          }
        }
      }
      Bitmap output = new Bitmap(width, height, PixelFormat.Format32bppArgb);
      Rectangle rect = new Rectangle(0, 0, width, height);
      BitmapData data = output.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
      Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
      output.UnlockBits(data);
      return output;
    }
  }

  public static Bitmap Roughness(Bitmap source, int center, double variation) {
    using (Bitmap src = ToArgb(source)) {
      int stride;
      byte[] input = ReadBgra(src, out stride);
      Bitmap output = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
      Rectangle rect = new Rectangle(0, 0, output.Width, output.Height);
      BitmapData data = output.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
      int outStride = Math.Abs(data.Stride);
      byte[] result = new byte[outStride * output.Height];
      for (int y = 0; y < output.Height; y++) {
        for (int x = 0; x < output.Width; x++) {
          int rough = (int)Math.Round(center + (128 - Luma(input, stride, output.Width, output.Height, x, y)) * variation);
          rough = Math.Max(150, Math.Min(245, rough));
          int i = y * outStride + x * 4;
          result[i] = result[i + 1] = result[i + 2] = (byte)rough;
          result[i + 3] = 255;
        }
      }
      Marshal.Copy(result, 0, data.Scan0, result.Length);
      output.UnlockBits(data);
      return output;
    }
  }

  public static Bitmap CleanAtlas(string path, int size, int keepComponents) {
    using (Bitmap original = new Bitmap(path))
    using (Bitmap src = ToArgb(original)) {
      int stride;
      byte[] pixels = ReadBgra(src, out stride);
      int count = src.Width * src.Height;
      bool[] foreground = new bool[count];
      for (int y = 0; y < src.Height; y++) {
        for (int x = 0; x < src.Width; x++) {
          int p = y * stride + x * 4;
          int b = pixels[p], g = pixels[p + 1], r = pixels[p + 2], a = pixels[p + 3];
          bool neonRed = r > 225 && g < 55 && b < 55;
          bool neonYellow = r > 225 && g > 205 && b < 75;
          bool neonGreen = g > 215 && r < 100 && b < 100;
          foreground[y * src.Width + x] = a >= 18 && !neonRed && !neonYellow && !neonGreen;
        }
      }

      bool[] visited = new bool[count];
      List<List<int>> components = new List<List<int>>();
      int[] queue = new int[count];
      int[] dx = new int[] { -1, 1, 0, 0 };
      int[] dy = new int[] { 0, 0, -1, 1 };
      for (int start = 0; start < count; start++) {
        if (!foreground[start] || visited[start]) continue;
        int head = 0, tail = 0;
        queue[tail++] = start;
        visited[start] = true;
        List<int> component = new List<int>();
        while (head < tail) {
          int current = queue[head++];
          component.Add(current);
          int cx = current % src.Width, cy = current / src.Width;
          for (int d = 0; d < 4; d++) {
            int nx = cx + dx[d], ny = cy + dy[d];
            if (nx < 0 || ny < 0 || nx >= src.Width || ny >= src.Height) continue;
            int next = ny * src.Width + nx;
            if (foreground[next] && !visited[next]) { visited[next] = true; queue[tail++] = next; }
          }
        }
        components.Add(component);
      }
      components.Sort((a, b) => b.Count.CompareTo(a.Count));
      bool[] keep = new bool[count];
      for (int c = 0; c < Math.Min(keepComponents, components.Count); c++)
        foreach (int index in components[c]) keep[index] = true;

      for (int y = 0; y < src.Height; y++) {
        for (int x = 0; x < src.Width; x++) {
          int index = y * src.Width + x;
          int p = y * stride + x * 4;
          if (!keep[index]) pixels[p + 3] = 0;
        }
      }
      Bitmap cleaned = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
      Rectangle rect = new Rectangle(0, 0, cleaned.Width, cleaned.Height);
      BitmapData data = cleaned.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
      Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
      cleaned.UnlockBits(data);
      Bitmap output = Resize(cleaned, size, size, PixelFormat.Format32bppArgb);
      cleaned.Dispose();
      return output;
    }
  }

  public static Bitmap CleanFlowerAtlas(string path, int size) {
    using (Bitmap original = new Bitmap(path))
    using (Bitmap src = ToArgb(original)) {
      int stride;
      byte[] pixels = ReadBgra(src, out stride);
      int count = src.Width * src.Height;
      int[] distance = new int[count];
      for (int i = 0; i < count; i++) distance[i] = Int32.MaxValue;
      int[] queue = new int[count];
      int head = 0, tail = 0;
      for (int y = 0; y < src.Height; y++) {
        for (int x = 0; x < src.Width; x++) {
          int p = y * stride + x * 4;
          int b = pixels[p], g = pixels[p + 1], r = pixels[p + 2], a = pixels[p + 3];
          bool neonGreen = g > 215 && r < 100 && b < 100;
          bool neonYellow = r > 225 && g > 205 && b < 75;
          bool greenAnchor = a >= 24 && !neonGreen && !neonYellow && g > 55 && g > r + 3 && g > b + 6;
          if (greenAnchor) {
            int index = y * src.Width + x;
            distance[index] = 0;
            queue[tail++] = index;
          }
        }
      }
      int[] dx = new int[] { -1, 1, 0, 0 };
      int[] dy = new int[] { 0, 0, -1, 1 };
      while (head < tail) {
        int current = queue[head++];
        int d = distance[current];
        if (d >= 36) continue;
        int cx = current % src.Width, cy = current / src.Width;
        for (int k = 0; k < 4; k++) {
          int nx = cx + dx[k], ny = cy + dy[k];
          if (nx < 0 || ny < 0 || nx >= src.Width || ny >= src.Height) continue;
          int next = ny * src.Width + nx;
          if (distance[next] > d + 1) { distance[next] = d + 1; queue[tail++] = next; }
        }
      }
      for (int y = 0; y < src.Height; y++) {
        for (int x = 0; x < src.Width; x++) {
          int index = y * src.Width + x;
          int p = y * stride + x * 4;
          int b = pixels[p], g = pixels[p + 1], r = pixels[p + 2];
          bool neonGreen = g > 215 && r < 100 && b < 100;
          bool neonYellow = r > 225 && g > 205 && b < 75;
          if (distance[index] > 36 || neonGreen || neonYellow || pixels[p + 3] < 18) pixels[p + 3] = 0;
        }
      }
      Bitmap cleaned = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
      Rectangle rect = new Rectangle(0, 0, cleaned.Width, cleaned.Height);
      BitmapData data = cleaned.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
      Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
      cleaned.UnlockBits(data);
      Bitmap output = Resize(cleaned, size, size, PixelFormat.Format32bppArgb);
      cleaned.Dispose();
      return output;
    }
  }
}
'@ -ReferencedAssemblies System.Drawing
}

$outputDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\textures-src'))
[System.IO.Directory]::CreateDirectory($outputDir) | Out-Null

function Save-Png([System.Drawing.Bitmap] $Bitmap, [string] $Name) {
  try { $Bitmap.Save((Join-Path $outputDir $Name), [System.Drawing.Imaging.ImageFormat]::Png) }
  finally { $Bitmap.Dispose() }
}

function Write-PbrSet([string] $Source, [string] $Prefix, [double] $NormalStrength, [int] $RoughCenter, [double] $RoughVariation) {
  $diff = [WishAssetTools]::PeriodicBlend($Source, 2048, 320)
  Save-Png $diff ($Prefix + '_diff.png')
  $diff = [System.Drawing.Bitmap]::FromFile((Join-Path $outputDir ($Prefix + '_diff.png')))
  try {
    Save-Png ([WishAssetTools]::EqualizeEdges([WishAssetTools]::NormalFromHeight($diff, $NormalStrength))) ($Prefix + '_nor_gl.png')
    Save-Png ([WishAssetTools]::Roughness($diff, $RoughCenter, $RoughVariation)) ($Prefix + '_rough.png')
  } finally { $diff.Dispose() }
}

if ($Pebbles -and $Leaves -and $FoxStone -and $Ripples) {
  Write-PbrSet $Pebbles 'riverbed_pebbles' 3.2 205 0.18
  Save-Png ([WishAssetTools]::CleanAtlas($Leaves, 2048, 15)) 'leaves_atlas.png'
  Write-PbrSet $FoxStone 'fox_stone' 1.8 222 0.10
  $rippleHeight = [WishAssetTools]::PeriodicBlend($Ripples, 1024, 160)
  try { Save-Png ([WishAssetTools]::EqualizeEdges([WishAssetTools]::NormalFromHeight($rippleHeight, 4.5))) 'water_ripple_nor_gl.png' }
  finally { $rippleHeight.Dispose() }
}

if ($CanopyMain -and $CanopyFine -and $MossGrass -and $RockMossyA -and $RockMossyB -and $RockLichen) {
  Save-Png ([WishAssetTools]::BalancedMask($CanopyMain, 2048, 320, 0.50)) 'canopy_shadow.png'
  Save-Png ([WishAssetTools]::BalancedMask($CanopyFine, 2048, 320, 0.52)) 'canopy_shadow_fine.png'
  Write-PbrSet $MossGrass 'ground_mossgrass' 2.8 218 0.14
  Write-PbrSet $RockMossyA 'rock_mossy_a' 3.0 205 0.16
  Write-PbrSet $RockMossyB 'rock_mossy_b' 3.0 200 0.17
  Write-PbrSet $RockLichen 'rock_lichen' 2.6 212 0.13
}

if ($Caustics -and $ShoreMud -and $ColorReference) {
  Save-Png ([WishAssetTools]::GrayscaleTexture($Caustics, 1024, 160)) 'caustics.png'
  Write-PbrSet $ShoreMud 'shore_mud' 2.2 190 0.18
  Save-Png ([WishAssetTools]::CenterCropResize($ColorReference, 2560, 1440)) 'reference_summer_wishing_pool.png'
}

if ($BroadleafAtlas -and $WhiteFlowerAtlas -and $WetRockHeight -and $NightReference) {
  Save-Png ([WishAssetTools]::CleanAtlas($BroadleafAtlas, 2048, 16)) 'broadleaf_groundplants_atlas.png'
  Save-Png ([WishAssetTools]::CleanFlowerAtlas($WhiteFlowerAtlas, 1024)) 'whiteflowers_moonglow_atlas.png'
  $wetRock = [WishAssetTools]::PeriodicBlend($WetRockHeight, 2048, 320)
  try { Save-Png ([WishAssetTools]::EqualizeEdges([WishAssetTools]::NormalFromHeight($wetRock, 3.4))) 'wet_rock_detail_nor_gl.png' }
  finally { $wetRock.Dispose() }
  Save-Png ([WishAssetTools]::CenterCropResize($NightReference, 2560, 1440)) 'reference_night_wishing_pool.png'
}

if ($LeafVeins) {
  $leafHeight = [WishAssetTools]::PeriodicBlend($LeafVeins, 1024, 128)
  try { Save-Png ([WishAssetTools]::EqualizeEdges([WishAssetTools]::NormalFromHeight($leafHeight, 2.0))) 'leaf_veins_nor_gl.png' }
  finally { $leafHeight.Dispose() }
}

if ($NightPanorama) {
  Save-Png ([WishAssetTools]::HorizontalPanorama($NightPanorama, 4096, 2048, 384)) 'night_canopy_panorama.png'
}

if ($RippleRings) {
  $rings = [WishAssetTools]::PeriodicBlend($RippleRings, 1024, 128)
  try { Save-Png ([WishAssetTools]::EqualizeEdges([WishAssetTools]::NormalFromHeight($rings, 2.2))) 'ripple_rings_nor_gl.png' }
  finally { $rings.Dispose() }
}

