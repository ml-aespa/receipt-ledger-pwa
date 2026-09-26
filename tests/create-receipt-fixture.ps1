Add-Type -AssemblyName System.Drawing
$outputPath = Join-Path $PSScriptRoot 'fixtures\receipt.png'
$bitmap = [System.Drawing.Bitmap]::new(1000, 1400)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::White)
$brush = [System.Drawing.Brushes]::Black
$font = [System.Drawing.Font]::new('Yu Gothic UI', 48)
$largeFont = [System.Drawing.Font]::new('Yu Gothic UI', 66, [System.Drawing.FontStyle]::Bold)
$lines = @(
    @('LAWSON', 100, 80, $largeFont),
    @('ローソン テスト店', 100, 190, $font),
    @('2026/09/25 12:30', 100, 310, $font),
    @('おにぎり          480円', 100, 490, $font),
    @('飲料              800円', 100, 600, $font),
    @('お買上合計  ￥1,280', 100, 790, $largeFont),
    @('内消費税          116円', 100, 940, $font),
    @('お預り          2,000円', 100, 1050, $font),
    @('お釣り            720円', 100, 1160, $font)
)
foreach ($item in $lines) {
    $graphics.DrawString($item[0], $item[3], $brush, [single]$item[1], [single]$item[2])
}
$bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$font.Dispose()
$largeFont.Dispose()
$bitmap.Dispose()
Write-Output $outputPath
