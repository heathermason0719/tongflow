"""Rebuild public, synthetic document acceptance samples (no user data)."""
import hashlib
import json
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1] / "tests/fixtures/documents"
ROOT.mkdir(parents=True, exist_ok=True)
paragraphs = [
    "清晨，小林推开窗，看见河面升起薄雾。他说：“今天，从一段文字开始！”",
    "午后，他沿着石板路走到旧书店，买下一本旅行笔记。书页上写着：保留中文、标点和自然段落。",
    "傍晚，他带着面包回到家，把当天的见闻写在第一页。序号 123、英文 A&B，以及表情 🙂 都应保留。",
]
plain = "\n\n".join(paragraphs) + "\n"
markdown = "# 河边的一天\n\n" + plain + "\n- **原文**不能被擅自改写。\n- 按照输入顺序，继续智能分段。\n"
long = "\n\n".join(
    f"第{i:04d}段：" + paragraphs[i % len(paragraphs)] + "这一段用于长篇中文验收，段号必须连续，末尾标点不能丢失。"
    for i in range(800)
) + "\n"
(ROOT / "short.txt").write_bytes(plain.encode())
(ROOT / "short.md").write_bytes(markdown.encode())
(ROOT / "long.txt").write_bytes(long.encode())

# A real OPC / WordprocessingML package, with styled runs and a two-cell table.
w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
body = "".join(
    '<w:p><w:r><w:t>' + escape(p[:4]) + '</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>' + escape(p[4:]) + '</w:t></w:r></w:p>'
    for p in paragraphs
)
body += '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格左列</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>表格右列</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
files = {
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="{w}"><w:body>{body}</w:body></w:document>',
}
with ZipFile(ROOT / "short.docx", "w") as package:
    for name, content in files.items():
        info = ZipInfo(name, (2020, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        package.writestr(info, content)

# Minimal valid, selectable-text PDF. Only provider routing is tested offline.
pdf_text = "Existing PDF routing regression."
stream = f"BT /F1 16 Tf 72 720 Td ({pdf_text}) Tj ET".encode()
objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>", b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream"]
pdf = bytearray(b"%PDF-1.4\n")
offsets = [0]
for i, obj in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
xref = len(pdf)
pdf += f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode()
pdf += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
pdf += f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
(ROOT / "existing.pdf").write_bytes(pdf)

expected = {
    "short.txt": plain,
    "short.md": markdown,
    "short.docx": "\n\n".join(paragraphs) + "\n\n表格左列\t表格右列",
    "long.txt": long,
    "existing.pdf": pdf_text,
}
manifest = {}
for name, text in expected.items():
    (ROOT / (name + ".expected.txt")).write_bytes(text.encode())
    manifest[name] = {"bytes": (ROOT / name).stat().st_size, "characters": len(text), "sha256": hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), "text_sha256": hashlib.sha256(text.encode()).hexdigest()}
(ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=4) + "\n")
print(json.dumps(manifest, ensure_ascii=False, indent=2))
