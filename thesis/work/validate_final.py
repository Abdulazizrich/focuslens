from pathlib import Path
import hashlib
import json
import re
import sys
from zipfile import ZipFile

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from pypdf import PdfReader

sys.stdout.reconfigure(encoding='utf-8')
base = Path(__file__).resolve().parent
path = base.parent / 'Xolmurodov_Abdulaziz_FocusLens_tezis.docx'
source = Path(r'C:\Users\Abdulaziz\Desktop\axborot xati uzb.2026.docx')
data = json.loads((base / 'content.json').read_text(encoding='utf-8'))
doc = Document(path)
checks = []

def check(label, condition):
    assert condition, label
    checks.append(label)

def paragraph_value(p, name):
    value = getattr(p.paragraph_format, name)
    style = p.style
    while value is None and style is not None:
        value = getattr(style.paragraph_format, name)
        style = style.base_style
    return value

check('One portrait A4 section', len(doc.sections) == 1)
s = doc.sections[0]
check('A4 dimensions', abs(s.page_width.cm-21)<0.01 and abs(s.page_height.cm-29.7)<0.01)
check('All four margins are 2 cm', all(abs(getattr(s,x).cm-2)<0.01 for x in ['top_margin','bottom_margin','left_margin','right_margin']))
check('All paragraphs use 1.15 line spacing', all(abs(paragraph_value(p,'line_spacing')-1.15)<0.001 for p in doc.paragraphs))
runs = [r for p in doc.paragraphs for r in p.runs if r.text]
check('All prose runs Times New Roman 14 pt black', all(r.font.name=='Times New Roman' and r.font.size.pt==14 and str(r.font.color.rgb)=='000000' for r in runs))
title = doc.paragraphs[1]
check('Uppercase centered bold title', title.text==data['title'] and title.text==title.text.upper() and title.alignment==WD_ALIGN_PARAGRAPH.CENTER and all(r.bold for r in title.runs if r.text))
author = doc.paragraphs[3]
check('Author and actual academic status bold italic', author.text==data['author'] and all(r.bold and r.italic for r in author.runs if r.text))
check('Complete supplied affiliation and email in italics', all(doc.paragraphs[i].text==data[k] and all(r.italic for r in doc.paragraphs[i].runs if r.text) for i,k in [(4,'affiliation'),(5,'email')]))
check('Required blank lines after title and before abstract and body', all(not doc.paragraphs[i].text for i in [2,6,9]))
check('Single paragraph abstract no more than 60 words', doc.paragraphs[7].text=='Annotatsiya. '+data['abstract'] and len(data['abstract'].split())<=60)
check('No more than seven keywords', len(data['keywords'])<=7 and doc.paragraphs[8].text=='Kalit so‘zlar: '+', '.join(data['keywords'])+'.')
body = doc.paragraphs[10:10+len(data['body'])]
for p,item in zip(body,data['body']):
    if isinstance(item,str):
        check('Body paragraph justified and indented 1 cm: '+item[:30], p.alignment==WD_ALIGN_PARAGRAPH.JUSTIFY and abs(paragraph_value(p,'first_line_indent').cm-1)<0.01 and p.text==re.sub(r'T_([fmda])',r'T\1',item))
check('Native editable equation', len(doc.element.xpath('.//m:oMath'))==1 and len(doc.element.xpath('.//m:f'))==1)
check('No decorative borders', not doc.element.xpath('.//w:pBdr') and not doc.styles.element.xpath('.//w:pBdr'))
check('No tracked changes or comment references', not any(doc.element.xpath('.//w:'+tag) for tag in ['ins','del','commentRangeStart','commentReference']))
check('Four numbered bibliography entries', [p.text for p in doc.paragraphs[-4:]]==data['references'] and all(r.startswith(str(i)+'. ') for i,r in enumerate(data['references'],1)))
text = '\n'.join(p.text for p in doc.paragraphs)
cited = {int(n) for group in re.findall(r'\[([\d, ]+)\]',text) for n in re.findall(r'\d+',group)}
check('All four references cited in body', cited=={1,2,3,4})
check('No template placeholders', not re.search(r'\b(?:TODO|TBD|Lorem ipsum|INSERT HERE)\b',text,re.I))
check('Source file unchanged', hashlib.sha256(source.read_bytes()).hexdigest()=='25925edb39153484d8d77d637558576fe27e227c8868b021fc7805c7f15ed8e4')
with ZipFile(path) as z:
    check('No comments part or external image relationships', not any('comments' in name for name in z.namelist()) and not any('media/' in name for name in z.namelist()))

pdf = PdfReader(base/'thesis-v3.pdf')
check('Native Word pagination produces three pages', len(pdf.pages)==3)
visible_fonts = set()
page_characters=[]
for page in pdf.pages:
    def visitor(txt,cm,tm,font,size):
        if txt.strip() and font:
            visible_fonts.add(str(font.get('/BaseFont','')))
    extracted = page.extract_text(visitor_text=visitor)
    page_characters.append(len(extracted.strip()))
check('Three substantial text pages', all(n>2000 for n in page_characters))
check('All rendered visible text uses Times New Roman', bool(visible_fonts) and all('TimesNewRoman' in f for f in visible_fonts))
check('Three rendered page images available', all((base/'final-v3'/f'page-{i}.png').is_file() for i in range(1,4)))
result = dict(output=str(path),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),pages=3,abstract_words=len(data['abstract'].split()),keywords=len(data['keywords']),page_characters=page_characters,visible_fonts=sorted(visible_fonts),checks_passed=checks,visual_inspection='All three final-v3 pages inspected; no clipping, overlap, unexpected borders or broken equation layout.')
(base/'final-validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(dict(checks_passed=len(checks),pages=3,abstract_words=result['abstract_words'],keywords=result['keywords'],output=str(path),sha256=result['sha256']),ensure_ascii=False,indent=2))
