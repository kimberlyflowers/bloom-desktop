# BLOOM Desktop Assets

This directory contains the icon assets for BLOOM Desktop.

## Required Icons

The following icon files are needed for the application to display properly:

### App Icons
- `icon.png` - Main application icon (512x512 PNG)
- `icon.icns` - macOS app icon bundle
- `icon.ico` - Windows app icon

### System Tray Icons
- `icon-tray.png` - macOS system tray icon (16x16 or 32x32 PNG)
- `icon-tray.ico` - Windows system tray icon

## Icon Requirements

- **Main App Icon**: Should be 512x512 pixels minimum, PNG format with transparency
- **System Tray**: Small icons (16x16 recommended) that work well at small sizes
- **Style**: Should match the BLOOM brand aesthetic with the 🌸 cherry blossom theme

## Creating Icons

You can create these icons using:
1. Design tools like Figma, Sketch, or Canva
2. Icon generation services like App Icon Generator
3. Convert PNG to ICNS using `iconutil` on macOS
4. Convert PNG to ICO using online converters or tools

## Temporary Workaround

For testing purposes, the application will attempt to fallback gracefully if icons are missing, but proper icons should be added for production builds.