from pathlib import Path
import json, hashlib, sys, re
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

sys.stdout.reconfigure(encoding='utf-8')
base = Path(__file__).resolve().parent
data = json.loads((base/'content.json').read_text(encoding='utf-8'))
source = Path(r'C:\Users\Abdulaziz\Desktop\axborot xati uzb.2026.docx')
output = base.parent/'Xolmurodov_Abdulaziz_FocusLens_tezis.docx'

# The source is a conference notice, not a manuscript template. Its written
# specifications (14 pt, 2 cm) take precedence over its 12 pt boxed example.
d = Document()
for border in d.styles.element.xpath('.//w:pBdr'):
    border.getparent().remove(border)
s = d.sections[0]
s.page_width, s.page_height = Cm(21), Cm(29.7)
s.top_margin = s.bottom_margin = s.left_margin = s.right_margin = Cm(2)
s.header_distance = s.footer_distance = Cm(1)
for sty in ['Normal','Title','Heading 1']:
    st=d.styles[sty]
    st.font.name='Times New Roman'; st.font.size=Pt(14); st.font.color.rgb=RGBColor(0,0,0)
    st.font.bold=False; st.font.italic=False
    st.paragraph_format.line_spacing=1.15
    st.paragraph_format.space_before=Pt(0); st.paragraph_format.space_after=Pt(0)
    st.paragraph_format.first_line_indent=Cm(1)
    st.paragraph_format.widow_control=True
    st.paragraph_format.keep_with_next=False
    st.paragraph_format.keep_together=False
    rp=st.element.get_or_add_rPr()
    fonts=rp.find(qn('w:rFonts'))
    if fonts is None: fonts=OxmlElement('w:rFonts'); rp.insert(0,fonts)
    for a in ['ascii','hAnsi','eastAsia','cs']: fonts.set(qn('w:'+a),'Times New Roman')
    lang=OxmlElement('w:lang'); lang.set(qn('w:val'),'uz-Latn-UZ'); rp.append(lang)

def run(p,text,bold=False,italic=False):
    r=p.add_run(text); r.font.name='Times New Roman'; r.font.size=Pt(14)
    r.bold=bold; r.italic=italic; r.font.color.rgb=RGBColor(0,0,0)
    return r

def paragraph(text='',align=WD_ALIGN_PARAGRAPH.JUSTIFY,bold=False,italic=False,style='Normal',keep=False):
    p=d.add_paragraph(style=style);p.alignment=align
    p.paragraph_format.keep_with_next=keep
    if align!=WD_ALIGN_PARAGRAPH.JUSTIFY: p.paragraph_format.first_line_indent=Cm(0)
    # Render variables in the prose with the same subscripts as the equation.
    for part in re.split(r'(T_[fmda])', text):
        if re.fullmatch(r'T_[fmda]',part):
            run(p,'T',italic=True)
            r=run(p,part[-1],italic=True);r.font.subscript=True
        else: run(p,part,bold,italic)
    return p

def blank():
    p=paragraph('',WD_ALIGN_PARAGRAPH.CENTER,keep=True)
    p.paragraph_format.keep_together=True

paragraph(data['section'],WD_ALIGN_PARAGRAPH.CENTER,keep=True)
paragraph(data['title'],WD_ALIGN_PARAGRAPH.CENTER,bold=True,style='Title',keep=True)
blank()
paragraph(data['author'],WD_ALIGN_PARAGRAPH.CENTER,bold=True,italic=True,keep=True)
paragraph(data['affiliation'],WD_ALIGN_PARAGRAPH.CENTER,italic=True,keep=True)
paragraph(data['email'],WD_ALIGN_PARAGRAPH.CENTER,italic=True,keep=True)
blank()
p=paragraph();run(p,'Annotatsiya. ',True,True);run(p,data['abstract'],italic=True)
p=paragraph();run(p,'Kalit so‘zlar: ',True,True);run(p,', '.join(data['keywords'])+'.',italic=True)
blank()

def math_run(text):
    r=OxmlElement('m:r')
    # Normal-text math runs retain the conference's Times New Roman face;
    # the fraction and subscripts remain native, editable Word structures.
    mrp=OxmlElement('m:rPr');mrp.append(OxmlElement('m:nor'));r.append(mrp)
    rp=OxmlElement('w:rPr'); fonts=OxmlElement('w:rFonts')
    fonts.set(qn('w:ascii'),'Times New Roman');fonts.set(qn('w:hAnsi'),'Times New Roman')
    rp.append(fonts);sz=OxmlElement('w:sz');sz.set(qn('w:val'),'28');rp.append(sz);r.append(rp)
    t=OxmlElement('m:t');t.text=text;r.append(t);return r

def term(sub):
    e=OxmlElement('m:sSub');body=OxmlElement('m:e');body.append(math_run('T'));e.append(body)
    sube=OxmlElement('m:sub');sube.append(math_run(sub));e.append(sube);return e

for item in data['body']:
    if isinstance(item,str): paragraph(item)
    else:
        p=paragraph('',WD_ALIGN_PARAGRAPH.CENTER,keep=True)
        om=OxmlElement('m:oMath')
        om.append(math_run('S = round [100 · '))
        frac=OxmlElement('m:f'); num=OxmlElement('m:num');den=OxmlElement('m:den')
        num.append(term('f'));num.append(math_run(' + 0,5 · '));num.append(term('m'))
        for i,key in enumerate(['f','m','d','a']):
            if i: den.append(math_run(' + '))
            den.append(term(key))
        frac.append(num);frac.append(den);om.append(frac);om.append(math_run(']'))
        p._p.append(om)

blank()
paragraph('Foydalanilgan adabiyotlar',WD_ALIGN_PARAGRAPH.CENTER,bold=True,keep=True)
for ref in data['references']: paragraph(ref)

cp=d.core_properties
cp.author='Xolmurodov Abdulaziz Dilmurod o‘g‘li'
cp.title=data['title'];cp.subject='5-sho‘ba uchun FocusLens ilmiy tezisi'
cp.keywords=', '.join(data['keywords']);cp.comments='';cp.last_modified_by=cp.author
d.save(output)
abstract_words=len(data['abstract'].split())
assert abstract_words<=60,abstract_words
assert len(data['keywords'])<=7
audit={
 'reference':str(source),'reference_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
 'output':str(output),'abstract_words':abstract_words,'keywords':len(data['keywords']),
 'body_words':sum(len(x.split()) for x in data['body'] if isinstance(x,str)),
 'all_words':sum(len(p.text.split()) for p in d.paragraphs),
 'a4_cm':[21,29.7],'margins_cm':2,'font':'Times New Roman','font_pt':14,'line_spacing':1.15,'body_first_line_cm':1,
 'note':'Written requirements override the notice example’s incidental 12-point font and page margins.'
}
(base/'format-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
(base/'artifact.md').write_text(f'''# Manuscript requirements contract
Reference: {source}
SHA-256: {audit['reference_sha256']}
Reference is a three-page conference notice, not a fill-in manuscript. Its cover, decorative rules, boxed example and organizer contact details are not manuscript content. All reference pages were rendered by Microsoft Word and inspected in reference-render/page-1.png through page-3.png.

Written requirements control: portrait A4 210 × 297 mm, 20 mm margins all sides, Times New Roman 14 pt, multiple line spacing 1.15, justified body, first line 10 mm. No header/footer or page numbers are requested. Target 3 complete pages, permitted 2–3.

Roles from the sample: centered section number, uppercase bold centered title, one blank line, bold italic author and actual status, italic institution/country, italic email, one blank line, one-paragraph italic abstract with bold italic label (max 60 words), italic keyword line (max seven terms), one blank line, body, one blank line, bold centered references heading and numbered bibliography with in-text numeric citations. Additional supplied faculty/speciality information belongs within the affiliation paragraph. No invented academic degree.

The notice sample's actual font is 12 pt and letter margins differ from its explicit instructions. Use the explicit 14 pt / 2 cm manuscript instructions. No title color, box, ornamental lines, conference cover, sample author or sample literature is carried into the new document. New styles are set to exact required values. User source must remain unchanged.

Scientific scope: section 5, local image processing and privacy architecture, functional testing. No invented field trial, accuracy rate, productivity improvement, peer-review guarantee or AI-detection claim. Sources are verified primary publications/documentation.

Rendering: packaged LibreOffice is unavailable on Windows and the canonical renderer failed with a missing soffice error. Use native Microsoft Word to paginate/export read-only, and the canonical rasterizer with that PDF for per-page PNG verification. Deliver only final DOCX.
''',encoding='utf-8')
print(json.dumps(audit,ensure_ascii=False,indent=2))
