#!/usr/bin/env python3
"""Render the maintained handoff Markdown to a paginated, searchable PDF."""
from pathlib import Path
import html
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    Preformatted, Flowable, KeepTogether,
)

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / 'Raydar-Grok-Handoff-v14.11.pdf'
INK = colors.HexColor('#213449')
BLUE = colors.HexColor('#48647e')
MUTED = colors.HexColor('#617284')
YELLOW = colors.HexColor('#edc84d')
PALE = colors.HexColor('#f0f4f7')
LINE = colors.HexColor('#d8e1e8')
FONTDIR = Path('/usr/share/fonts/truetype/dejavu')
if (FONTDIR / 'DejaVuSans.ttf').exists():
    for name, filename in [('Body','DejaVuSans.ttf'), ('BodyBold','DejaVuSans-Bold.ttf'),
                           ('Code','DejaVuSansMono.ttf')]:
        pdfmetrics.registerFont(TTFont(name, str(FONTDIR / filename)))
    pdfmetrics.registerFontFamily('Body', normal='Body', bold='BodyBold', italic='Body', boldItalic='BodyBold')
    BODY, BOLD, CODE = 'Body', 'BodyBold', 'Code'
else:
    BODY, BOLD, CODE = 'Helvetica', 'Helvetica-Bold', 'Courier'

WIDTH, HEIGHT = A4
MARGIN = 46
CONTENT = WIDTH - 2 * MARGIN
styles = {
    'body': ParagraphStyle('body', fontName=BODY, fontSize=9.1, leading=13.2,
                           textColor=INK, spaceAfter=7.5, splitLongWords=True),
    'h1': ParagraphStyle('h1', fontName=BOLD, fontSize=20.5, leading=25,
                         textColor=INK, spaceAfter=18, keepWithNext=True),
    'cover': ParagraphStyle('cover', fontName=BOLD, fontSize=32, leading=38,
                            textColor=INK, spaceBefore=10, spaceAfter=18, keepWithNext=True),
    'h2': ParagraphStyle('h2', fontName=BOLD, fontSize=11.4, leading=15,
                         textColor=BLUE, spaceBefore=10, spaceAfter=6, keepWithNext=True),
    'cell': ParagraphStyle('cell', fontName=BODY, fontSize=8.1, leading=11.2,
                           textColor=INK, spaceAfter=0, splitLongWords=True),
    'thead': ParagraphStyle('thead', fontName=BOLD, fontSize=8.1, leading=11.2,
                            textColor=colors.white, spaceAfter=0, splitLongWords=True),
    'bullet': ParagraphStyle('bullet', fontName=BODY, fontSize=9.1, leading=13.2,
                             textColor=INK, leftIndent=12, firstLineIndent=-10, spaceAfter=5.8),
}

def inline(value):
    value = html.escape(value)
    value = re.sub(r'`([^`]+)`', lambda m: '<font name="%s" size="8">%s</font>' % (CODE, m.group(1)), value)
    value = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', value)
    value = re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)', r'<link href="\2" color="#48647e">\1</link>', value)
    return value

class Architecture(Flowable):
    def __init__(self):
        Flowable.__init__(self)
        self.width, self.height = CONTENT, 142
    def draw(self):
        c = self.canv
        boxes = [(0,82,146,44,'Mobile UI','Next.js + Capacitor'),
                 (177,82,146,44,'Scoped API reads','Existing HTTPS backend'),
                 (356,82,146,44,'Firebase','Auth / Firestore'),
                 (0,8,146,44,'Durable outbox','Actor + time + GPS'),
                 (177,8,146,44,'Idempotent writes','Existing lead records')]
        for x,y,w,h,title,sub in boxes:
            c.setFillColor(PALE); c.setStrokeColor(LINE)
            c.roundRect(x,y,w,h,5,stroke=1,fill=1)
            c.setFillColor(INK); c.setFont(BOLD,9); c.drawString(x+10,y+26,title)
            c.setFillColor(MUTED); c.setFont(BODY,7.2); c.drawString(x+10,y+12,sub)
        c.setStrokeColor(BLUE); c.setFillColor(BLUE); c.setLineWidth(1)
        for x1,y1,x2,y2 in [(146,104,177,104),(323,104,356,104),(73,82,73,52),
                             (146,30,177,30),(323,30,429,82)]:
            c.line(x1,y1,x2,y2)
            import math
            ang=math.atan2(y2-y1,x2-x1)
            for d in (-0.5,0.5):
                c.line(x2,y2,x2-5*math.cos(ang+d),y2-5*math.sin(ang+d))

class HandoffDoc(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name in ('h1','cover'):
            title = flowable.getPlainText()
            key = 'section-%s' % self.page
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(title,key,level=0,closed=False)

def chrome(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(INK); canvas.rect(0,HEIGHT-11,WIDTH,11,stroke=0,fill=1)
    canvas.setFillColor(YELLOW); canvas.rect(MARGIN,HEIGHT-11,55,11,stroke=0,fill=1)
    canvas.setFont(BOLD,8); canvas.setFillColor(BLUE)
    canvas.drawString(MARGIN,HEIGHT-37,'RAYDAR / PROJECT TRANSFER')
    canvas.setFont(BODY,8)
    canvas.drawRightString(WIDTH-MARGIN,HEIGHT-37,'v14.11  |  build 151')
    canvas.setStrokeColor(LINE); canvas.line(MARGIN,42,WIDTH-MARGIN,42)
    canvas.setFont(BODY,7.1); canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN,28,'Happy Solar  /  Source-based handoff  /  17 Oct 2026 UTC')
    canvas.drawRightString(WIDTH-MARGIN,28,str(doc.page))
    canvas.restoreState()

def parse_section(section, cover=False):
    lines=section.strip().splitlines()
    story=[]; i=0
    while i < len(lines):
        line=lines[i].strip()
        if not line:
            i+=1; continue
        if line == '<!-- ARCHITECTURE -->':
            story.extend([Architecture(),Spacer(1,8)]); i+=1; continue
        if line.startswith('```'):
            code=[]; i+=1
            while i<len(lines) and not lines[i].startswith('```'):
                code.append(lines[i]); i+=1
            widest=max([pdfmetrics.stringWidth(x,CODE,8) for x in code] or [1])
            size=min(8,8*(CONTENT-22)/widest)
            style=ParagraphStyle('code',fontName=CODE,fontSize=size,leading=size*1.45,
                                  textColor=INK,leftIndent=0,spaceBefore=0,spaceAfter=0)
            box=Table([[Preformatted('\n'.join(code),style)]],colWidths=[CONTENT])
            box.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),PALE),
                ('BOX',(0,0),(-1,-1),0.5,LINE),('LEFTPADDING',(0,0),(-1,-1),10),
                ('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),9),
                ('BOTTOMPADDING',(0,0),(-1,-1),9)]))
            story.extend([box,Spacer(1,10)]); i+=1; continue
        if line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].strip().startswith('|'):
                cells=[x.strip() for x in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r'[:\- ]+',x) for x in cells): rows.append(cells)
                i+=1
            n=len(rows[0]); ratios=[0.36,0.64] if n==2 else [0.28,0.34,0.38]
            data=[[Paragraph(inline(v),styles['thead' if r==0 else 'cell']) for v in row] for r,row in enumerate(rows)]
            table=Table(data,colWidths=[CONTENT*r for r in ratios],repeatRows=1,hAlign='LEFT')
            table.setStyle(TableStyle([
                ('BACKGROUND',(0,0),(-1,0),INK),('VALIGN',(0,0),(-1,-1),'TOP'),
                ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,PALE]),
                ('LINEBELOW',(0,0),(-1,0),1,YELLOW),('LINEBELOW',(0,1),(-1,-1),0.4,LINE),
                ('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),
                ('TOPPADDING',(0,0),(-1,-1),5.5),('BOTTOMPADDING',(0,0),(-1,-1),5.5)]))
            story.extend([table,Spacer(1,9)]); continue
        if line.startswith('# '):
            story.append(Paragraph(inline(line[2:]),styles['cover' if cover else 'h1']))
        elif line.startswith('## '):
            story.append(Paragraph(inline(line[3:]),styles['h2']))
        elif line.startswith('- '):
            story.append(Paragraph('&#8226; '+inline(line[2:]),styles['bullet']))
        elif re.match(r'^\d+\. ',line):
            story.append(Paragraph(inline(line),styles['bullet']))
        else:
            paragraph=[line]
            while i+1<len(lines) and lines[i+1].strip() and not re.match(r'^(#|\||```|- |\d+\. |<!--)',lines[i+1].strip()):
                i+=1; paragraph.append(lines[i].strip())
            story.append(Paragraph(inline(' '.join(paragraph)),styles['body']))
        i+=1
    return story

def main():
    document=HandoffDoc(str(OUTPUT),pagesize=A4,rightMargin=MARGIN,leftMargin=MARGIN,
                        topMargin=62,bottomMargin=56,title='Raydar v14.11 — Grok Project Handoff',
                        author='Happy Solar / Raydar project handoff',subject='Source, builds, operations, verification and takeover')
    sections=(ROOT/'HANDOFF.md').read_text().split('<!-- PAGE -->')
    flow=[]
    for number,section in enumerate(sections):
        if number: flow.append(PageBreak())
        flow.extend(parse_section(section,cover=number==0))
    document.build(flow,onFirstPage=chrome,onLaterPages=chrome)
    print(OUTPUT)

if __name__=='__main__': main()
