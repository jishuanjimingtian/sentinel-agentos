# Download ffmpeg static build and encode frames to MP4
$ErrorActionPreference = 'Stop'
$promo = 'C:\Users\十号\.openclaw\workspace\projects\agentos\promo'
$frames = "$promo\frames"
$url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
$zip = "$env:TEMP\ffmpeg.zip"
$extract = "$env:TEMP\ffmpeg-extract"

Write-Host "Downloading ffmpeg..."
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

Write-Host "Extracting..."
Expand-Archive -Path $zip -DestinationPath $extract -Force

$ffmpeg = Get-ChildItem -Path $extract -Filter ffmpeg.exe -Recurse | Select-Object -First 1 -ExpandProperty FullName
Write-Host "ffmpeg at: $ffmpeg"

Write-Host "Encoding MP4..."
& $ffmpeg -y -framerate 30 -i "$frames\frame-%05d.png" -c:v libx264 -pix_fmt yuv420p -preset fast -crf 23 "$promo\douyin.mp4" 2>&1

$mp4 = Get-Item "$promo\douyin.mp4"
Write-Host "Done! Video: $($mp4.FullName) ($([math]::Round($mp4.Length/1024/1024, 1)) MB)"
