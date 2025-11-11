# Generate the standard sizes
mkdir dipper.iconset
sips -z 16 16     dipper.png --out dipper.iconset/icon_16x16.png
sips -z 32 32     dipper.png --out dipper.iconset/icon_32x32.png
sips -z 64 64     dipper.png --out dipper.iconset/icon_64x64.png
sips -z 128 128   dipper.png --out dipper.iconset/icon_128x128.png
sips -z 256 256   dipper.png --out dipper.iconset/icon_256x256.png
sips -z 512 512   dipper.png --out dipper.iconset/icon_512x512.png
sips -z 1024 1024 dipper.png --out dipper.iconset/icon_1024x1024.png

# Create the @2x (Retina) versions by copying the larger sizes
cp dipper.iconset/icon_32x32.png dipper.iconset/icon_16x16@2x.png
cp dipper.iconset/icon_64x64.png dipper.iconset/icon_32x32@2x.png
cp dipper.iconset/icon_256x256.png dipper.iconset/icon_128x128@2x.png
cp dipper.iconset/icon_512x512.png dipper.iconset/icon_256x256@2x.png
cp dipper.iconset/icon_1024x1024.png dipper.iconset/icon_512x512@2x.png

iconutil -c icns dipper.iconset