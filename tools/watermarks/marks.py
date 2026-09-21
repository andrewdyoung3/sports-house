import math, sys, os, io, re
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
from shapely.geometry import Polygon, LineString
from shapely.ops import unary_union
from g3d import *
from g3d import _iter_polys
import resvg_py
from PIL import Image

OUT=os.environ.get('WM_OUT','/Users/andreasjenkins/Documents/SportHouse/public/watermarks')
W=H=400; CX=CY=200
WHITE='#f4f4f4'; BLACK='#111'; GREY='#8a8a8a'
BRAND='SPORTHOUSE'

def tighten(svg):
    """Crop the viewBox to the painted alpha so padRight stays 0%."""
    png=resvg_py.svg_to_bytes(svg_string=svg, width=W, height=H)
    a=Image.open(io.BytesIO(bytes(png))).convert('RGBA').split()[3]
    x0,y0,x1,y1=a.getbbox(); pad=2
    x0=max(0,x0-pad); y0=max(0,y0-pad); x1=min(W,x1+pad); y1=min(H,y1+pad)
    return re.sub(r'viewBox="[^"]+" width="\d+" height="\d+"', f'viewBox="{x0} {y0} {x1-x0} {y1-y0}" width="{x1-x0}" height="{y1-y0}"', svg, count=1)

def write(name, sc, label, note):
    p=f'{OUT}/{name}.svg'; open(p,'w').write(tighten(sc.svg(label,note))); return p

def seams4(sc, p0, offset=0.0, light=0.45, dark=0.55):
    for k in (-3,-1,1,3):
        m=meridian(p0+offset+k*math.pi/4)
        sc.stroke(m, '#fff', 2.4, light); sc.stroke(m, '#000', 1.5, dark)

# ═══════════════════════ RUGBY (Gilbert reference) ═══════════════════════
def rugby():
    b=Body(1.5,1.0, yaw=0.32, pitch=0.10, tilt=math.radians(34), cx=CX, cy=CY, scale=118)
    sc=Scene(b,W,H); p0=b.phi0
    sc.raw(f'<path d="{sc.silhouette_path()}" fill="{WHITE}"/>')
    e_near=lambda d: 1.00+0.22*math.sin(d+0.9)
    e_far =lambda d: math.pi-(1.00+0.22*math.sin(d-2.2))
    near=cap(e_near, p0); far=cap_far(e_far, p0)
    sc.fill(near, BLACK, 0.92); sc.fill(far, BLACK, 0.92)
    # tapered white swoosh through each black panel, with a grey accent beside it;
    # both confined to their panel so nothing crosses onto the body
    for edge, sgn, capp in ((e_near, 1, near), (e_far, -1, far)):
        wdt=lambda d: 0.13*max(0.0, 1-((d+0.35)/1.25)**2)
        lo=lambda d, e=edge, s=sgn: e(d)-s*(0.22+wdt(d))-s*0.06*math.cos(d)
        hi=lambda d, e=edge, s=sgn: e(d)-s*0.22-s*0.06*math.cos(d)
        sw=strip(lambda d: (lo(d), p0+d), lambda d: (hi(d), p0+d), -1.6, 0.9)
        sc.fill(sw.intersection(capp), WHITE, 0.95)
        gw=lambda d: 0.06*max(0.0, 1-((d+0.35)/1.0)**2)
        gs=strip(lambda d: (edge(d)-sgn*(0.10+gw(d)), p0+d), lambda d: (edge(d)-sgn*0.10, p0+d), -1.3, 0.6)
        sc.fill(gs.intersection(capp), GREY, 0.9)
    seams4(sc, p0)
    sc.text(BRAND, math.pi/2+0.10, p0-0.26, 0.215, BLACK, 0.92, skew=0.22, tracking=-0.02)
    sc.text('RUGBY', math.pi/2+0.10, p0+0.13, 0.115, GREY, 0.95, skew=0.22)
    sc.text('SIZE 5', math.pi/2+0.34, p0+0.38, 0.065, BLACK, 0.7, fontpath=ARIAL_BOLD)
    cid=sc.shade(light=(-0.45,-0.42), form=0.66, rim=0.30, spec=0.60, spec_r=0.30, rim_light=0.5)
    sc.leather(cid, amount=0.09, freq=1.1)
    return write('rugby-union', sc, 'Rugby ball', 'Rugby ball — modelled on a modern four-panel match ball (Gilbert reference)')

# ═══════════════════════ AFL (Sherrin) ═══════════════════════
def afl():
    b=Body(1.36,1.0, yaw=-0.30, pitch=0.12, tilt=math.radians(-16), cx=CX, cy=CY, scale=126)
    sc=Scene(b,W,H); p0=b.phi0
    sc.raw(f'<path d="{sc.silhouette_path()}" fill="#7a7a7a"/>')          # red leather in greyscale
    seams4(sc, p0, offset=math.pi/4, light=0.35, dark=0.6)                 # laced seam faces the viewer
    # lace panel on the front seam: a dark slot with the laces crossing it
    L=0.62
    slot=band_phi(-0.045,0.045, math.pi/2-L, math.pi/2+L, p0)
    sc.fill(slot, '#1a1a1a', 0.9)
    for i in range(5):
        t=math.pi/2-L+0.12+i*(2*L-0.24)/4
        lace=band_phi(-0.12,0.12, t-0.04, t+0.04, p0)
        sc.fill(lace, '#e8e8e8', 0.95)
        sc.stroke(LineString([(t+0.04,p0-0.12),(t+0.04,p0+0.12)]), '#000', 1.2, 0.35)
    # end stitching rows the Sherrin is known for
    for te in (0.55, math.pi-0.55):
        sc.stroke(parallel(te, p0), '#fff', 1.6, 0.35)
        sc.stroke(parallel(te+ (0.06 if te<1 else -0.06), p0), '#000', 1.0, 0.35)
    sc.text(BRAND, math.pi/2, p0-0.48, 0.20, '#f2f2f2', 0.95, skew=0.18, tracking=-0.02)
    sc.text('AUSTRALIAN RULES', math.pi/2, p0-0.78, 0.075, '#f2f2f2', 0.8, fontpath=ARIAL_BOLD, tracking=0.06)
    sc.text('SIZE 5', math.pi/2, p0+0.55, 0.065, '#f2f2f2', 0.7, fontpath=ARIAL_BOLD)
    cid=sc.shade(light=(-0.42,-0.45), form=0.70, rim=0.32, spec=0.42, spec_r=0.34, rim_light=0.45)
    sc.leather(cid, amount=0.12, freq=1.3)
    return write('ball-afl', sc, 'Australian rules football', 'Australian rules football — laced four-panel ball (Sherrin form)')

# ═══════════════════════ GRIDIRON ═══════════════════════
def gridiron():
    b=Body(1.66,1.0, yaw=0.26, pitch=0.14, tilt=math.radians(-28), cx=CX, cy=CY, scale=112)
    sc=Scene(b,W,H); p0=b.phi0
    sc.raw(f'<path d="{sc.silhouette_path()}" fill="#666"/>')
    # end stripes
    for ta,tb in ((0.62,0.78),(math.pi-0.78,math.pi-0.62)):
        sc.fill(band_phi(-math.pi,math.pi, ta,tb, p0), '#f0f0f0', 0.92)
    seams4(sc, p0, offset=math.pi/4, light=0.35, dark=0.6)
    L=0.66
    sc.fill(band_phi(-0.05,0.05, math.pi/2-L, math.pi/2+L, p0), '#1a1a1a', 0.9)
    for i in range(8):
        t=math.pi/2-L+0.09+i*(2*L-0.18)/7
        sc.fill(band_phi(-0.17,0.17, t-0.038, t+0.038, p0), '#ececec', 0.95)
        sc.stroke(LineString([(t+0.038,p0-0.17),(t+0.038,p0+0.17)]), '#000', 1.0, 0.35)
    sc.stroke(LineString([(math.pi/2-L,p0-0.19),(math.pi/2+L,p0-0.19)]), '#ececec', 2.0, 0.85)
    sc.stroke(LineString([(math.pi/2-L,p0+0.19),(math.pi/2+L,p0+0.19)]), '#ececec', 2.0, 0.85)
    sc.text(BRAND, math.pi/2, p0+0.50, 0.17, '#f2f2f2', 0.95, skew=0.18, tracking=-0.02)
    sc.text('GRIDIRON', math.pi/2, p0+0.76, 0.075, '#f2f2f2', 0.8, fontpath=ARIAL_BOLD, tracking=0.08)
    cid=sc.shade(light=(-0.42,-0.45), form=0.70, rim=0.32, spec=0.40, spec_r=0.34, rim_light=0.45)
    sc.leather(cid, amount=0.13, freq=1.3)
    return write('ball-gridiron', sc, 'Gridiron football', 'Gridiron football — laced, striped, four panels')

# ═══════════════════════ FOOTBALL (32-panel) ═══════════════════════
def football():
    b=Body(1.0,1.0, cx=CX, cy=CY, scale=156)
    sc=Scene(b,W,H)
    sc.raw(f'<path d="{sc.silhouette_path()}" fill="{WHITE}"/>')
    pents,hexes=truncated_icosahedron()
    # orient: a hexagon square to the viewer, then a little turn for life
    c=np.mean(hexes[0],axis=0); c/=np.linalg.norm(c)
    M=rotmat(np.cross(c,[0,0,1]), math.acos(float(c@[0,0,1])))
    M=rotmat([0,1,0],0.22)@rotmat([1,0,0],-0.18)@rotmat([0,0,1],0.35)@M
    P=[[M@p for p in r] for r in pents]; Hx=[[M@p for p in r] for r in hexes]
    for r in P: sc.fill3d([arc_ring(r)], BLACK, 0.92)
    for r in P+Hx:
        pts=arc_ring(r,12); pts.append(pts[0])
        sc.stroke3d(pts, '#000', 1.3, 0.5)
    # wordmark on the front hexagon
    front=max(Hx, key=lambda r: float(np.mean(r,axis=0)@[0,0,1]))
    fc=np.mean(front,axis=0); fc/=np.linalg.norm(fc)
    t0=math.acos(fc[0]); ph0=math.atan2(fc[2],fc[1])
    sc.text(BRAND, t0, ph0-0.06, 0.105, BLACK, 0.9, tracking=-0.02)
    sc.text('FOOTBALL', t0, ph0+0.12, 0.07, GREY, 0.95, fontpath=ARIAL_BOLD, tracking=0.05)
    cid=sc.shade(light=(-0.42,-0.42), form=0.62, rim=0.30, spec=0.55, spec_r=0.32, rim_light=0.5)
    return write('ball-football', sc, 'Football', 'Football — classic 32-panel ball')

# ═══════════════════════ BASKETBALL ═══════════════════════
def basketball():
    b=Body(1.0,1.0, yaw=-0.42, tilt=math.radians(90), cx=CX, cy=CY, scale=156)
    sc=Scene(b,W,H); p0=b.phi0; L=p0+0.25
    sc.raw(f'<path d="{sc.silhouette_path()}" fill="#8c8c8c"/>')
    ch=lambda ln: (sc.stroke(ln,'#000',7.0,0.85), sc.stroke(ln,'#fff',1.2,0.18))
    ch(parallel(math.pi/2, p0))                                  # equator
    ch(meridian(L+math.pi/2)); ch(meridian(L-math.pi/2))         # vertical seam
    lm=0.78
    for base in (L, L+math.pi):
        for s in (1,-1):
            ch(curve(lambda t, s=s, base=base: (t, base+s*lm*math.sin(t)), 0.0, math.pi))
    sc.text(BRAND, math.pi/2-0.40, L, 0.17, '#111', 0.9, angle=math.pi/2, tracking=-0.02, flip=True)
    sc.text('BASKETBALL', math.pi/2-0.19, L, 0.075, '#111', 0.8, angle=math.pi/2, fontpath=ARIAL_BOLD, tracking=0.08, flip=True)
    sc.text('OFFICIAL SIZE 7', math.pi/2-0.07, L, 0.06, '#111', 0.7, angle=math.pi/2, fontpath=ARIAL_BOLD, tracking=0.04, flip=True)
    cid=sc.shade(light=(-0.42,-0.42), form=0.66, rim=0.32, spec=0.45, spec_r=0.34, rim_light=0.45)
    sc.leather(cid, amount=0.16, freq=1.8, seed=7)
    return write('ball-basketball', sc, 'Basketball', 'Basketball — eight-panel channel pattern')

# ═══════════════════════ CRICKET ═══════════════════════
def cricket():
    b=Body(1.0,1.0, yaw=-0.55, pitch=0.0, tilt=math.radians(62), cx=CX, cy=CY, scale=156)
    sc=Scene(b,W,H); p0=b.phi0
    sc.raw(f'<path d="{sc.silhouette_path()}" fill="#5a5a5a"/>')
    # raised equatorial seam: a band with six rows of stitching
    sc.fill(band_phi(-math.pi,math.pi, math.pi/2-0.11, math.pi/2+0.11, p0), '#4a4a4a', 1.0)
    sc.stroke(parallel(math.pi/2-0.11, p0), '#000', 1.2, 0.5); sc.stroke(parallel(math.pi/2+0.11, p0), '#000', 1.2, 0.5)
    sc.stroke(parallel(math.pi/2, p0), '#fff', 1.2, 0.25)
    for row in (-0.085,-0.05,-0.015,0.015,0.05,0.085):
        for i in range(90):
            ph=p0-math.pi+i*2*math.pi/90; d=0.028
            sc.stroke(LineString([(math.pi/2+row-0.012, ph),(math.pi/2+row+0.012, ph+d)]), '#e6e6e6', 1.1, 0.8)
    # gold stamp on one half
    tc=math.pi/2-0.58
    sc.text(BRAND, tc, p0-0.02, 0.15, '#d8d0b0', 0.9, angle=math.pi/2, tracking=-0.02, flip=True)
    sc.text('CRICKET', tc+0.20, p0-0.02, 0.075, '#d8d0b0', 0.85, angle=math.pi/2, fontpath=ARIAL_BOLD, tracking=0.12, flip=True)
    sc.text('156 g', tc+0.38, p0-0.02, 0.06, '#d8d0b0', 0.75, angle=math.pi/2, fontpath=ARIAL_BOLD, flip=True)
    cid=sc.shade(light=(-0.40,-0.44), form=0.70, rim=0.34, spec=0.75, spec_r=0.30, rim_light=0.55)
    sc.leather(cid, amount=0.07, freq=1.2)
    return write('ball-cricket', sc, 'Cricket ball', 'Cricket ball — six-row seam, stamped')

# ═══════════════════════ BASEBALL ═══════════════════════
def baseball():
    b=Body(1.0,1.0, yaw=0.35, pitch=0.25, tilt=math.radians(20), cx=CX, cy=CY, scale=156)
    sc=Scene(b,W,H)
    sc.raw(f'<path d="{sc.silhouette_path()}" fill="{WHITE}"/>')
    a=0.4
    def seam(t):
        th=math.pi/2-(math.pi/2-a)*math.cos(t); ph=t/2+a*math.sin(2*t)
        return np.array([math.sin(th)*math.cos(ph), math.sin(th)*math.sin(ph), math.cos(th)])
    M=rotmat([1,0,0],0.9)@rotmat([0,0,1],0.6)
    pts=[M@seam(t) for t in np.linspace(0,4*math.pi,720)]
    sc.stroke3d(pts, '#000', 2.0, 0.40)
    sc.stroke3d(pts, '#fff', 0.8, 0.5)
    # stitches: paired V marks across the seam
    for i in range(0,720,7):
        p=pts[i]; q=pts[min(i+1,719)]; tng=q-p; tng/=np.linalg.norm(tng); nrm=np.cross(p,tng)
        for s in (1,-1):
            A=p+s*nrm*0.012; Bp=p+s*nrm*0.055+tng*0.022*s
            sc.stroke3d([A/np.linalg.norm(A),Bp/np.linalg.norm(Bp)], '#4a4a4a', 2.2, 0.95)
    sc.text(BRAND, math.pi/2+0.30, b.phi0-0.05, 0.12, '#333', 0.85, tracking=-0.02)
    sc.text('BASEBALL', math.pi/2+0.30, b.phi0+0.17, 0.06, '#5a5a5a', 0.85, fontpath=ARIAL_BOLD, tracking=0.1)
    cid=sc.shade(light=(-0.42,-0.42), form=0.60, rim=0.30, spec=0.50, spec_r=0.34, rim_light=0.5)
    return write('ball-baseball', sc, 'Baseball', 'Baseball — figure-eight seam, 108 stitches')

# ═══════════════════════ PUCK (planar construction) ═══════════════════════
def puck():
    r=150; k=0.42; h=72; cx,cy=200,182
    sc=Scene(Body(1,1,cx=cx,cy=cy,scale=r),W,H)
    top=f'M{cx-r} {cy} A{r} {r*k} 0 1 1 {cx+r} {cy} A{r} {r*k} 0 1 1 {cx-r} {cy} Z'
    side=f'M{cx-r} {cy} A{r} {r*k} 0 0 0 {cx+r} {cy} L{cx+r} {cy+h} A{r} {r*k} 0 0 1 {cx-r} {cy+h} Z'
    sc.defs.append(f'<linearGradient id="pside" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a3a3a"/><stop offset="0.35" stop-color="#1b1b1b"/><stop offset="0.8" stop-color="#0c0c0c"/><stop offset="1" stop-color="#262626"/></linearGradient>')
    sc.defs.append(f'<radialGradient id="ptop" cx="0.36" cy="0.30" r="0.75"><stop offset="0" stop-color="#4a4a4a"/><stop offset="0.5" stop-color="#232323"/><stop offset="1" stop-color="#121212"/></radialGradient>')
    sc.defs.append(f'<clipPath id="pclip"><path d="{side}"/></clipPath><clipPath id="tclip"><path d="{top}"/></clipPath>')
    sc.raw(f'<path d="{side}" fill="url(#pside)"/>')
    # knurled edge: vertical grooves, spaced by the curvature
    g=[]
    for i in range(48):
        th=math.pi*(i+0.5)/48; x=cx-r*math.cos(th); y0=cy+r*k*math.sin(th)
        op=0.10+0.25*math.sin(th)
        g.append(f'<path d="M{x:.1f} {y0+3:.1f} L{x:.1f} {y0+h-3:.1f}" stroke="#fff" stroke-opacity="{op:.2f}" stroke-width="1.6"/>')
    sc.raw(f'<g clip-path="url(#pclip)">{"".join(g)}</g>')
    sc.raw(f'<path d="{top}" fill="url(#ptop)"/>')
    # top face: rings and text (planar ellipse mapping)
    def E(u,v): return (cx+u, cy+v*k)
    def ring(rr, col, w, op):
        sc.raw(f'<ellipse cx="{cx}" cy="{cy}" rx="{rr}" ry="{rr*k:.1f}" fill="none" stroke="{col}" stroke-width="{w}" stroke-opacity="{op}"/>')
    ring(r-10,'#fff',1.2,0.16); ring(r-16,'#000',1.2,0.5); ring(r*0.58,'#fff',1.0,0.14)
    # curved wordmark around the upper arc of the face
    g,adv=text_polys(BRAND, ARIAL_BLACK, 34, tracking=0.04)
    R0=r*0.74; parts=[]
    for p in _iter_polys(g):
        p=p.segmentize(2.0)
        def mp(x,y):
            ang=-math.pi/2+(x-adv/2)/R0; rr=R0+y
            return E(rr*math.cos(ang), rr*math.sin(ang))
        rings=[[mp(x,y) for x,y in p.exterior.coords]]+[[mp(x,y) for x,y in i.coords] for i in p.interiors]
        parts+= [sc._ring(rg) for rg in rings]
    sc.raw(f'<path d="{" ".join(parts)}" fill="#d9d9d9" fill-opacity="0.9" fill-rule="evenodd"/>')
    g,adv=text_polys('ICE HOCKEY', ARIAL_BOLD, 17, tracking=0.12)
    parts=[]
    for p in _iter_polys(g):
        rings=[[E(x-adv/2, -(y)+8) for x,y in p.exterior.coords]]+[[E(x-adv/2, -(y)+8) for x,y in i.coords] for i in p.interiors]
        parts+=[sc._ring(rg) for rg in rings]
    sc.raw(f'<path d="{" ".join(parts)}" fill="#d9d9d9" fill-opacity="0.85" fill-rule="evenodd"/>')
    g,adv=text_polys('OFFICIAL', ARIAL_BOLD, 12, tracking=0.2)
    parts=[]
    for p in _iter_polys(g):
        rings=[[E(x-adv/2, -(y)+80) for x,y in p.exterior.coords]]+[[E(x-adv/2, -(y)+80) for x,y in i.coords] for i in p.interiors]
        parts+=[sc._ring(rg) for rg in rings]
    sc.raw(f'<path d="{" ".join(parts)}" fill="#d9d9d9" fill-opacity="0.7" fill-rule="evenodd"/>')
    # gloss on the face and a rim highlight along the top edge
    sc.defs.append('<linearGradient id="pgloss" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.32"/><stop offset="0.55" stop-color="#fff" stop-opacity="0"/></linearGradient>')
    sc.raw(f'<path d="{top}" fill="url(#pgloss)"/>')
    sc.defs.append('<linearGradient id="prim" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.25"/><stop offset="1" stop-color="#fff" stop-opacity="0.6"/></linearGradient>')
    sc.raw(f'<path d="{top}" fill="none" stroke="url(#prim)" stroke-width="2.2"/>')
    sc.raw(f'<path d="{side}" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="1.4"/>')
    return write('puck-hockey', sc, 'Hockey puck', 'Hockey puck — knurled edge, stamped face')

# ═══════════════════════ CHEQUERED FLAG (waving cloth) ═══════════════════════
def flag():
    sc=Scene(Body(1,1,cx=CX,cy=CY,scale=1),W,H)
    x0,y0,fw,fh=40,100,320,215; nx,ny=8,6
    amp=lambda u: 4+26*u**1.4                       # flutter grows toward the fly
    wave=lambda u: math.sin(2*math.pi*1.25*u-0.6)
    def M(u,v):                                     # cloth (u,v) in [0,1]² → screen
        return (x0+fw*u+10*(1-v)*u, y0+fh*v+amp(u)*wave(u)+18*u)
    parts_b=[]; parts_w=[]
    for i in range(nx):
        for j in range(ny):
            us=np.linspace(i/nx,(i+1)/nx,6); vs=np.linspace(j/ny,(j+1)/ny,3)
            ring=[M(u,j/ny) for u in us]+[M((i+1)/nx,v) for v in vs[1:]]+[M(u,(j+1)/ny) for u in us[::-1][1:]]+[M(i/nx,v) for v in vs[::-1][1:]]
            (parts_b if (i+j)%2==0 else parts_w).append(sc._ring(ring))
    outline=[M(u,0) for u in np.linspace(0,1,40)]+[M(1,v) for v in np.linspace(0,1,10)][1:]+[M(u,1) for u in np.linspace(1,0,40)][1:]+[M(0,v) for v in np.linspace(1,0,10)][1:]
    od=sc._ring(outline)
    sc.defs.append(f'<clipPath id="fclip"><path d="{od}"/></clipPath>')
    sc.raw(f'<path d="{" ".join(parts_w)}" fill="{WHITE}" fill-rule="evenodd"/>')
    sc.raw(f'<path d="{" ".join(parts_b)}" fill="{BLACK}" fill-opacity="0.92" fill-rule="evenodd"/>')
    # fold shading follows the wave: dark on the downslope, a lift on the crests
    stops=[]
    for i in range(0,81):
        u=i/80; sl=-2*math.pi*1.25*math.cos(2*math.pi*1.25*u-0.6)*amp(u)/fh   # d(y)/du sign → slope
        d=max(0.0,min(1.0, 0.5+0.9*sl)); stops.append(f'<stop offset="{u:.3f}" stop-color="#000" stop-opacity="{0.55*d*min(1,0.25+u):.3f}"/>')
    sc.defs.append('<linearGradient id="ffold" x1="0" y1="0" x2="1" y2="0">'+''.join(stops)+'</linearGradient>')
    stops=[]
    for i in range(0,81):
        u=i/80; sl=-2*math.pi*1.25*math.cos(2*math.pi*1.25*u-0.6)*amp(u)/fh
        d=max(0.0,min(1.0, 0.5-0.9*sl)); stops.append(f'<stop offset="{u:.3f}" stop-color="#fff" stop-opacity="{0.28*d*min(1,0.25+u):.3f}"/>')
    sc.defs.append('<linearGradient id="fcrest" x1="0" y1="0" x2="1" y2="0">'+''.join(stops)+'</linearGradient>')
    sc.defs.append('<linearGradient id="fvert" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.10"/><stop offset="1" stop-color="#000" stop-opacity="0.22"/></linearGradient>')
    sc.raw(f'<g clip-path="url(#fclip)"><rect x="0" y="0" width="{W}" height="{H}" fill="url(#ffold)"/><rect x="0" y="0" width="{W}" height="{H}" fill="url(#fcrest)"/><rect x="0" y="0" width="{W}" height="{H}" fill="url(#fvert)"/></g>')
    # hem stitching and the hoist sleeve
    inner=[M(u,0.035) for u in np.linspace(0.02,0.98,40)]+[M(0.98,v) for v in np.linspace(0.035,0.965,10)][1:]+[M(u,0.965) for u in np.linspace(0.98,0.02,40)][1:]+[M(0.02,v) for v in np.linspace(0.965,0.035,10)][1:]
    sc.raw(f'<path d="{sc._ring(inner)}" fill="none" stroke="#888" stroke-width="1" stroke-opacity="0.55" stroke-dasharray="3 2.5"/>')
    sc.raw(f'<path d="{od}" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="1.5"/>')
    sleeve=[M(0,0),M(0.045,0),M(0.045,1),M(0,1)]
    sc.raw(f'<path d="{sc._ring(sleeve)}" fill="#bbb" fill-opacity="0.9"/><path d="{sc._ring(sleeve)}" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="1.2"/>')
    return write('flag-motorsport', sc, 'Chequered flag', 'Chequered flag — waving cloth with fold shading')

ALL=['rugby','afl','gridiron','football','basketball','cricket','baseball','puck','flag']
if __name__=='__main__':
    which=sys.argv[1:] or ALL
    for w in which: print(globals()[w]())
