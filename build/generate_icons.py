#!/usr/bin/env python3
"""
VoltPOS Icon Generator
Generates icon.icns (Mac) and icon.ico (Windows) from the source PNG.
Run this once before pushing to GitHub, or GitHub Actions handles it.
"""

import os
import struct
import zlib
import shutil
import subprocess
import sys

def check_deps():
    """Check for required tools."""
    tools = []
    if shutil.which('convert'):
        tools.append('imagemagick')
    if shutil.which('png2icns'):
        tools.append('png2icns')
    return tools

def create_ico_from_png(png_path, ico_path):
    """Create a Windows .ico file from a PNG using pure Python."""
    with open(png_path, 'rb') as f:
        png_data = f.read()

    # ICO file format
    sizes = [16, 32, 48, 64, 128, 256]

    try:
        from PIL import Image
        import io

        img = Image.open(png_path).convert('RGBA')
        entries = []
        images = []

        for size in sizes:
            resized = img.resize((size, size), Image.LANCZOS)
            buf = io.BytesIO()
            resized.save(buf, format='PNG')
            images.append(buf.getvalue())
            entries.append((size, size, len(images[-1])))

        # ICO header
        header = struct.pack('<HHH', 0, 1, len(sizes))

        # Calculate offsets
        offset = 6 + len(sizes) * 16
        dir_entries = b''
        for i, (w, h, size) in enumerate(entries):
            actual_w = w if w < 256 else 0
            actual_h = h if h < 256 else 0
            dir_entries += struct.pack('<BBBBHHII',
                actual_w, actual_h, 0, 0, 1, 32, size, offset)
            offset += size

        with open(ico_path, 'wb') as f:
            f.write(header + dir_entries)
            for img_data in images:
                f.write(img_data)

        print(f'  Created {ico_path}')
        return True

    except ImportError:
        print('  Pillow not available, trying fallback...')
        # Simple fallback: copy PNG as ICO (works for basic cases)
        shutil.copy(png_path, ico_path)
        return True

def create_icns_placeholder(icns_path, png_path):
    """Create a placeholder icns or copy from png."""
    try:
        from PIL import Image
        import io
        import struct

        img = Image.open(png_path).convert('RGBA')

        # Try iconutil on Mac
        if sys.platform == 'darwin':
            iconset_dir = icns_path.replace('.icns', '.iconset')
            os.makedirs(iconset_dir, exist_ok=True)

            for size in [16, 32, 64, 128, 256, 512, 1024]:
                resized = img.resize((size, size), Image.LANCZOS)
                resized.save(os.path.join(iconset_dir, f'icon_{size}x{size}.png'))
                if size <= 512:
                    resized2 = img.resize((size*2, size*2), Image.LANCZOS)
                    resized2.save(os.path.join(iconset_dir, f'icon_{size}x{size}@2x.png'))

            result = subprocess.run(['iconutil', '-c', 'icns', iconset_dir, '-o', icns_path], capture_output=True)
            shutil.rmtree(iconset_dir, ignore_errors=True)
            if result.returncode == 0:
                print(f'  Created {icns_path}')
                return True

        # Fallback: copy PNG (electron-builder can convert)
        shutil.copy(png_path, icns_path.replace('.icns', '.png'))
        print(f'  Saved icon as PNG (electron-builder will convert)')
        return True

    except Exception as e:
        shutil.copy(png_path, icns_path.replace('.icns', '.png'))
        return True

def create_dmg_background():
    """Create a simple DMG background."""
    try:
        from PIL import Image, ImageDraw, ImageFont
        img = Image.new('RGB', (540, 380), color='#0e1117')
        draw = ImageDraw.Draw(img)

        # Draw arrow hint
        draw.text((270, 320), '→ Drag to Applications', fill='#6b7a99', anchor='mm')

        img.save('build/dmg-background.png')
        print('  Created DMG background')
    except Exception:
        # Create minimal background
        w, h = 540, 380
        # Minimal PNG
        raw = b'\x89PNG\r\n\x1a\n'
        ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
        ihdr_chunk = make_png_chunk(b'IHDR', ihdr)
        row = b'\x00' + b'\x0e\x11\x17' * w
        idat_data = zlib.compress(row * h)
        idat_chunk = make_png_chunk(b'IDAT', idat_data)
        iend_chunk = make_png_chunk(b'IEND', b'')
        with open('build/dmg-background.png', 'wb') as f:
            f.write(raw + ihdr_chunk + idat_chunk + iend_chunk)

def make_png_chunk(chunk_type, data):
    chunk = chunk_type + data
    crc = zlib.crc32(chunk) & 0xffffffff
    return struct.pack('>I', len(data)) + chunk + struct.pack('>I', crc)

if __name__ == '__main__':
    os.makedirs('build', exist_ok=True)

    src_512 = 'src/icons/icon-512.png'
    src_192 = 'src/icons/icon-192.png'
    src = src_512 if os.path.exists(src_512) else src_192

    if not os.path.exists(src):
        print(f'ERROR: Source icon not found at {src}')
        sys.exit(1)

    print('Generating VoltPOS icons...')
    create_ico_from_png(src, 'build/icon.ico')
    create_icns_placeholder('build/icon.icns', src)
    create_dmg_background()
    print('Done!')
