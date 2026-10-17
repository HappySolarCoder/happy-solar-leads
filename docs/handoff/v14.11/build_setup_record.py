#!/usr/bin/env python3
"""Render the companion completion and setup record using the handoff style."""
from pathlib import Path
import build_handoff as layout
from reportlab.platypus import PageBreak, Table, TableStyle

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / 'Raydar-Completed-Work-and-Setup-v14.11.pdf'

def chrome(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(layout.INK)
    canvas.rect(0,layout.HEIGHT-11,layout.WIDTH,11,stroke=0,fill=1)
    canvas.setFillColor(layout.YELLOW)
    canvas.rect(layout.MARGIN,layout.HEIGHT-11,55,11,stroke=0,fill=1)
    canvas.setFont(layout.BOLD,8); canvas.setFillColor(layout.BLUE)
    canvas.drawString(layout.MARGIN,layout.HEIGHT-37,'RAYDAR / COMPLETION AND SETUP')
    canvas.setFont(layout.BODY,8)
    canvas.drawRightString(layout.WIDTH-layout.MARGIN,layout.HEIGHT-37,'v14.11  |  build 151')
    canvas.setStrokeColor(layout.LINE)
    canvas.line(layout.MARGIN,42,layout.WIDTH-layout.MARGIN,42)
    canvas.setFont(layout.BODY,7.1); canvas.setFillColor(layout.MUTED)
    canvas.drawString(layout.MARGIN,28,'Happy Solar  /  Setup history and current evidence  /  16 Oct 2026 Phoenix')
    canvas.drawRightString(layout.WIDTH-layout.MARGIN,28,str(doc.page))
    canvas.restoreState()

def main():
    layout.styles['body'].leading=12.7
    layout.styles['body'].spaceAfter=6
    layout.styles['bullet'].leading=12.7
    layout.styles['bullet'].spaceAfter=4.6
    layout.styles['h2'].spaceBefore=8
    doc=layout.HandoffDoc(str(OUTPUT),pagesize=layout.A4,
        rightMargin=layout.MARGIN,leftMargin=layout.MARGIN,topMargin=62,bottomMargin=56,
        title='Raydar - Completed Work and Setup through v14.11',
        author='Happy Solar / Raydar project record',
        subject='Completed application work, Xcode, Android Studio, Apple and cloud setup')
    flow=[]
    for i,section in enumerate((ROOT/'COMPLETED-AND-SETUP.md').read_text().split('<!-- PAGE -->')):
        if i: flow.append(PageBreak())
        section_flow=layout.parse_section(section,cover=i==0)
        for item in section_flow:
            if isinstance(item,Table):
                item.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),4.5),
                                          ('BOTTOMPADDING',(0,0),(-1,-1),4.5)]))
        flow.extend(section_flow)
    doc.build(flow,onFirstPage=chrome,onLaterPages=chrome)
    print(OUTPUT)

if __name__=='__main__': main()
