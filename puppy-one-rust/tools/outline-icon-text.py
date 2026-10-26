#!/usr/bin/env python3
"""Convert the registry's static SVG text to the actual product Geist outlines.
No OS-font fallback: GPUI's SVG font database does not include app text fonts.
stdin/stdout: JSON string arrays. Only explicitly supported static text is accepted.
"""
import json
import sys
import xml.etree.ElementTree as ET
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
font = instantiateVariableFont(TTFont(sys.argv[1]), {'wght':600}, inplace=True)
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
upem = font['head'].unitsPerEm
ns = '{http://www.w3.org/2000/svg}'
ET.register_namespace('',ns[1:-1])
result=[]
for svg in json.load(sys.stdin):
    if '<text ' not in svg:
        result.append(svg)
        continue
    tree=ET.fromstring(svg)
    for parent in tree.iter():
        for child in list(parent):
            if child.tag not in ['text',ns+'text']:
                continue
            if list(child) or child.get('font-weight')!='600' or child.get('text-anchor')!='middle' or child.get('font-family')!='var(--po-font-sans)':
                raise ValueError('Unsupported icon text; extend the explicit outline contract')
            text=child.text or ''
            scale=float(child.get('font-size'))/upem
            names=[cmap[ord(c)] for c in text]
            total=sum(glyphs[n].width for n in names)*scale
            x=float(child.get('x'))-total/2
            y=float(child.get('y'))
            pen=SVGPathPen(glyphs)
            for name in names:
                glyphs[name].draw(TransformPen(pen,(scale,0,0,-scale,x,y)))
                x+=glyphs[name].width*scale
            replacement=ET.Element(ns+'path',{'d':pen.getCommands(),'fill':child.get('fill','currentColor')})
            parent.insert(list(parent).index(child),replacement)
            parent.remove(child)
    result.append(ET.tostring(tree,encoding='unicode'))
json.dump(result,sys.stdout)
