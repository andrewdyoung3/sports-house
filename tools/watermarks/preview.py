"""Faithful preview: rasterise the SVG with resvg, composite at card opacity on
both card grounds (no mono filter — the files are used as-is)."""
import sys, resvg_py
from PIL import Image, ImageDraw

DARK=(0x16,0x16,0x17); LIGHT=(0xfb,0xfa,0xfc)

def raster(svg_path, h):
    svg=open(svg_path).read()
    png=resvg_py.svg_to_bytes(svg_string=svg, height=h)
    import io
    return Image.open(io.BytesIO(bytes(png))).convert('RGBA')

def sheet(paths, out, h=220, opacity=0.4, pad=24):
    ims=[raster(p,h) for p in paths]
    w=sum(i.width for i in ims)+pad*(len(ims)+1)
    S=Image.new('RGB',(w, 2*h+3*pad))
    for row,bg in enumerate((DARK,LIGHT)):
        y=pad+row*(h+pad)
        ImageDraw.Draw(S).rectangle([0,y-pad//2,w,y+h+pad//2],fill=bg)
        x=pad
        for im in ims:
            a=im.split()[3].point(lambda v:int(v*opacity))
            card=Image.new('RGB',im.size,bg); card.paste(im.convert('RGB'),(0,0),a)
            S.paste(card,(x,y)); x+=im.width+pad
    S.save(out)

if __name__=='__main__':
    out=sys.argv[1]; op=float(sys.argv[2]); paths=sys.argv[3:]
    sheet(paths,out,opacity=op)
