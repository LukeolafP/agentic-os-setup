#!/bin/sh
# Builds "Petra Computer.app" next to this script (GTD, 7 Nov 2026). See main.swift.
# A rebuild changes the ad-hoc signature, so macOS asks for both permissions again.
set -e
cd "$(dirname "$0")"
APP="Petra Computer.app"
mkdir -p "$APP/Contents/MacOS"
swiftc -O -target arm64-apple-macos14.0 main.swift -o "$APP/Contents/MacOS/PetraComputer" -framework AppKit -framework Network -framework ApplicationServices
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.gettruckdrivers.petra-computer</string>
  <key>CFBundleName</key><string>Petra Computer</string>
  <key>CFBundleDisplayName</key><string>Petra Computer</string>
  <key>CFBundleExecutable</key><string>PetraComputer</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --sign - --identifier com.gettruckdrivers.petra-computer "$APP"
echo "built $APP"
