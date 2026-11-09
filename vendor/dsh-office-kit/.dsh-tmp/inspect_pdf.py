import fitz
import json
import sys

doc = fitz.open(sys.argv[1])
page = doc[0]
print("page rect:", page.rect)
print("rotation:", page.rotation)
print("---- blocks ----")
for block in page.get_text("dict")["blocks"]:
    if block["type"] != 0:
        print("IMAGE block", block["bbox"])
        continue
    for line in block["lines"]:
        for span in line["spans"]:
            print(
                f"bbox={tuple(round(v, 2) for v in span['bbox'])} "
                f"font={span['font']!r} size={span['size']:.2f} "
                f"flags={span['flags']} color={span['color']:#08x} "
                f"origin={tuple(round(v, 2) for v in span['origin'])} "
                f"text={span['text']!r}"
            )
print("---- drawings ----")
for d in page.get_drawings():
    print(
        "type=", d.get("type"),
        "rect=", tuple(round(v, 2) for v in d["rect"]),
        "fill=", d.get("fill"),
        "color=", d.get("color"),
        "width=", d.get("width"),
        "items=", d.get("items")[:3],
    )
print("---- images ----")
for img in page.get_images(full=True):
    print(img)
print("---- links ----")
for link in page.get_links():
    print(link)
