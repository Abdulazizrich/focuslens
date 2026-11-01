"""Use the packaged rasterizer with a PDF paginated by native Microsoft Word.

Windows runtime includes Poppler but no bundled LibreOffice. The native Word
conversion is performed separately; keep the canonical rasterization/PNG names.
"""
import sys, os, importlib.util, shutil
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
skill=Path(r'C:\Users\Abdulaziz\.codex\plugins\cache\openai-primary-runtime\documents\26.1013.11914\skills\documents')
spec=importlib.util.spec_from_file_location('packaged_render_docx',skill/'render_docx.py')
renderer=importlib.util.module_from_spec(spec);spec.loader.exec_module(renderer)
docx,pdf,out=map(lambda v:Path(v).resolve(),sys.argv[1:4])
if not docx.exists() or not pdf.exists(): raise FileNotFoundError('Word conversion output missing')
def word_pdf(_doc_path,_profile,tmp,stem,verbose=False):
    target=Path(tmp)/(stem+'.pdf');shutil.copy2(pdf,target)
    return str(target),'PDF supplied by Microsoft Word ExportAsFixedFormat'
renderer.convert_to_pdf=word_pdf
for p in renderer.rasterize(str(docx),str(out),140,False,False):print(p)
