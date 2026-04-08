#!/usr/bin/env python3
"""
arabic_to_zpl.py
Renders a line of Arabic (or mixed) text to a ZPL ^GF hex bitmap.

Usage:
  python3 arabic_to_zpl.py "<text>" <width> <height> <font_size>

Outputs JSON: { "hex": "...", "bytes_per_row": N, "total_bytes": N, "width": W, "height": H }
"""
import sys, json
from PIL import Image, ImageDraw, ImageFont
import arabic_reshaper
from bidi.algorithm import get_display

FONT_PATH = '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf'

def has_arabic(text):
    for ch in text:
        if '\u0600' <= ch <= '\u06FF' or '\u0750' <= ch <= '\u077F' or '\uFB50' <= ch <= '\uFDFF' or '\uFE70' <= ch <= '\uFEFF':
            return True
    return False

def render_text_to_zpl_grf(text, width, height, font_size):
    # Shape and reorder Arabic text for correct rendering
    if has_arabic(text):
        reshaped = arabic_reshaper.reshape(text)
        display_text = get_display(reshaped)
    else:
        display_text = text

    # Create white image
    img = Image.new('1', (width, height), 1)  # 1-bit, white background
    draw = ImageDraw.Draw(img)

    try:
        font = ImageFont.truetype(FONT_PATH, font_size)
    except Exception:
        font = ImageFont.load_default()

    # Get text bounding box and center/right-align
    bbox = draw.textbbox((0, 0), display_text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    # Right-align for Arabic, left-align for Latin
    if has_arabic(text):
        x = width - text_w - 4
    else:
        x = 4
    y = (height - text_h) // 2

    draw.text((x, y), display_text, font=font, fill=0)  # black text

    # Convert to ZPL GRF hex
    # Each row: ceil(width/8) bytes
    bytes_per_row = (width + 7) // 8
    total_bytes = bytes_per_row * height

    hex_str = ''
    pixels = img.load()
    for row in range(height):
        row_bytes = []
        for byte_idx in range(bytes_per_row):
            byte_val = 0
            for bit in range(8):
                px = byte_idx * 8 + bit
                if px < width:
                    # In 1-bit image: 0=black, 1=white; ZPL: 1=black, 0=white
                    pixel = pixels[px, row]
                    if pixel == 0:  # black pixel
                        byte_val |= (1 << (7 - bit))
            row_bytes.append(byte_val)
        hex_str += ''.join(f'{b:02X}' for b in row_bytes)

    result = {
        'hex': hex_str,
        'bytes_per_row': bytes_per_row,
        'total_bytes': total_bytes,
        'width': width,
        'height': height
    }
    print(json.dumps(result))

if __name__ == '__main__':
    text = sys.argv[1]
    width = int(sys.argv[2])
    height = int(sys.argv[3])
    font_size = int(sys.argv[4])
    render_text_to_zpl_grf(text, width, height, font_size)
