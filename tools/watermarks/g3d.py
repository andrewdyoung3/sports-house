"""3D-projected sport-ball watermarks.

A ball is a spheroid (semi-axes a, b, b) in its own body frame. Every design
feature — panel, seam, stripe, wordmark — is described on the SURFACE in
(t, phi) parameters, clipped to the visible hemisphere in that same parameter
space, and only then projected to the screen. Shading is layered on top with
SVG gradients aligned to the projected silhouette. The output is greyscale
with alpha and is used WITHOUT the mono filter: a white ball on a dark card is
defined by its lit body, on a light card by its dark panels and shadow — the
same two readings the reference photograph gives.
"""
import math
import numpy as np
from shapely.geometry import Polygon, LineString, MultiPolygon, MultiLineString, GeometryCollection
from shapely.ops import unary_union
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

# ───────────────────────── glyph outlines ─────────────────────────
class FlatPen(BasePen):
    def __init__(self, gs, steps=10):
        super().__init__(gs); self.contours=[]; self.cur=None; self.steps=steps
    def _moveTo(self, p): self.cur=[p]
    def _lineTo(self, p): self.cur.append(p)
    def _curveToOne(self, p1, p2, p3):
        p0=self.cur[-1]
        for i in range(1,self.steps+1):
            u=i/self.steps; m=1-u
            self.cur.append((m**3*p0[0]+3*m*m*u*p1[0]+3*m*u*u*p2[0]+u**3*p3[0],
                             m**3*p0[1]+3*m*m*u*p1[1]+3*m*u*u*p2[1]+u**3*p3[1]))
    def _qCurveToOne(self, p1, p2):
        p0=self.cur[-1]
        for i in range(1,self.steps+1):
            u=i/self.steps; m=1-u
            self.cur.append((m*m*p0[0]+2*m*u*p1[0]+u*u*p2[0], m*m*p0[1]+2*m*u*p1[1]+u*u*p2[1]))
    def _closePath(self):
        if self.cur and len(self.cur)>2: self.contours.append(self.cur)
        self.cur=None
    def _endPath(self): self._closePath()

_FONTS={}
def font(path, index=0):
    key=(path,index)
    if key not in _FONTS:
        f=TTFont(path, fontNumber=index); _FONTS[key]=(f, f.getGlyphSet(), f.getBestCmap(), f['head'].unitsPerEm)
    return _FONTS[key]

def text_polys(s, fontpath, size, index=0, tracking=0.0, skew=0.0):
    """Shapely (Multi)Polygon of a string, baseline at y=0, x from 0, height in `size`."""
    f, gs, cmap, upm = font(fontpath, index)
    sc=size/upm; x=0.0; polys=[]
    for ch in s:
        gname=cmap.get(ord(ch))
        if gname is None: x+=0.3*size; continue
        g=gs[gname]
        if ch!=' ':
            pen=FlatPen(gs); g.draw(pen)
            conts=[Polygon([(x+px*sc+py*sc*skew, py*sc) for px,py in c]) for c in pen.contours]
            conts=[c.buffer(0) for c in conts if c.is_valid or True]
            # nonzero winding ≈ even/odd depth for Latin glyphs
            conts=sorted([c for c in conts if not c.is_empty], key=lambda c:-c.area)
            shape=None
            for c in conts:
                depth=sum(1 for o in conts if o is not c and o.area>c.area and o.contains(c.representative_point()))
                shape = c if shape is None and depth%2==0 else (shape.union(c) if depth%2==0 else shape.difference(c))
            if shape is not None and not shape.is_empty: polys.append(shape)
        x+=g.width*sc + tracking*size
    return unary_union(polys) if polys else Polygon(), x

ARIAL_BLACK='/System/Library/Fonts/Supplemental/Arial Black.ttf'
DIN_COND='/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf'
IMPACT='/System/Library/Fonts/Supplemental/Impact.ttf'
ARIAL_BOLD='/System/Library/Fonts/Supplemental/Arial Bold.ttf'

# ───────────────────────── body + projection ─────────────────────────
def Rx(a): c,s=math.cos(a),math.sin(a); return np.array([[1,0,0],[0,c,-s],[0,s,c]])
def Ry(a): c,s=math.cos(a),math.sin(a); return np.array([[c,0,s],[0,1,0],[-s,0,c]])
def Rz(a): c,s=math.cos(a),math.sin(a); return np.array([[c,-s,0],[s,c,0],[0,0,1]])

class Body:
    """Spheroid with long axis X (semi-axis a) and round section radius b.

    yaw   — turns the long axis toward the viewer (about screen-vertical)
    pitch — tips the long axis up/down (about screen-horizontal)
    tilt  — rotation in the screen plane
    Screen: x right, y UP (flipped at output), z toward the viewer.
    """
    def __init__(self, a, b, yaw=0.0, pitch=0.0, tilt=0.0, cx=0.0, cy=0.0, scale=1.0):
        self.a,self.b=a,b
        self.R=Rz(tilt)@Rx(pitch)@Ry(yaw)
        self.v=self.R.T@np.array([0,0,1.0])           # view dir in body frame
        vx,vy,vz=self.v
        self.phi0=math.atan2(vz,vy)                    # meridian facing the viewer
        self.cx,self.cy,self.s=cx,cy,scale
        # meridian arc length table for text placement
        ts=np.linspace(0,math.pi,2001)
        ds=np.sqrt((a*np.sin(ts))**2+(b*np.cos(ts))**2)
        self.arc=np.concatenate([[0],np.cumsum((ds[1:]+ds[:-1])/2*np.diff(ts))])
        self.ts=ts
    # parameter helpers
    def t_of_arc(self, s): return float(np.interp(s, self.arc, self.ts))
    def arc_of_t(self, t): return float(np.interp(t, self.ts, self.arc))
    def surf(self, t, phi):
        return np.array([self.a*math.cos(t), self.b*math.sin(t)*math.cos(phi), self.b*math.sin(t)*math.sin(phi)])
    def visible_range(self, t):
        """(phi0-w, phi0+w) visible at latitude t; w in [0, pi]."""
        vx,vy,vz=self.v
        A=math.cos(t)*vx/self.a; B=math.sin(t)*math.hypot(vy,vz)/self.b
        if B<1e-9: return math.pi if A>0 else 0.0
        c=-A/B
        if c<=-1: return math.pi
        if c>=1: return 0.0
        return math.acos(c)
    def visible_poly(self, n=400):
        top=[]; bot=[]
        for i in range(n+1):
            t=math.pi*i/n; w=self.visible_range(t)
            top.append((t, self.phi0+w)); bot.append((t, self.phi0-w))
        return Polygon(top+bot[::-1]).buffer(0)
    def project_pt(self, t, phi):
        p=self.R@self.surf(t,phi)
        return (self.cx+self.s*p[0], self.cy-self.s*p[1])
    def depth(self, t, phi):
        return (self.R@self.surf(t,phi))[2]
    # ── screen-space silhouette (projected boundary of V) ──
    def silhouette(self, n=400):
        # Only parallels the terminator actually crosses (0<w<pi). Where a pole
        # is fully visible/hidden both sides collapse onto one meridian and the
        # path would double back on itself — a spur that renders as a stray tick
        # once the rim-light/outline strokes are applied.
        pts=[]; eps=1e-6
        for i in range(n):
            t=math.pi*i/n; w=self.visible_range(t)
            if eps<w<math.pi-eps: pts.append(self.project_pt(t, self.phi0+w))
        for i in range(n,0,-1):
            t=math.pi*i/n; w=self.visible_range(t)
            if eps<w<math.pi-eps: pts.append(self.project_pt(t, self.phi0-w))
        return pts
    def ellipse_fit(self):
        """(cx, cy, rmaj, rmin, angle_deg) of the projected silhouette (PCA)."""
        P=np.array(self.silhouette())
        c=P.mean(0); Q=P-c
        cov=Q.T@Q/len(P)+np.eye(2)*1e-9; w,v=np.linalg.eigh(cov)
        # extreme extents along eigen axes
        ext=[np.abs(Q@v[:,k]).max() for k in range(2)]
        k=int(np.argmax(ext)); j=1-k
        ang=math.degrees(math.atan2(v[1,k],v[0,k]))
        if ext[k]/max(ext[j],1e-9)<1.02: ang=0.0; ext[k]=ext[j]=max(ext)   # a circle has no axis
        return c[0],c[1],ext[k],ext[j],ang

# ───────────────────────── param-space → svg ─────────────────────────
def _iter_polys(g):
    if g.is_empty: return []
    if isinstance(g,Polygon): return [g]
    if isinstance(g,(MultiPolygon,GeometryCollection)): return [p for q in g.geoms for p in _iter_polys(q)]
    return []
def _iter_lines(g):
    if g.is_empty: return []
    if isinstance(g,LineString): return [g]
    if isinstance(g,(MultiLineString,GeometryCollection)): return [l for q in g.geoms for l in _iter_lines(q)]
    return []

def fmt(x): return f'{x:.1f}'

class Scene:
    def __init__(self, body: Body, W, H):
        self.b=body; self.W=W; self.H=H; self.V=body.visible_poly(); self.out=[]; self.defs=[]; self.nid=0
    def uid(self, p='g'): self.nid+=1; return f'{p}{self.nid}'
    def _ring(self, coords):
        return 'M'+' L'.join(f'{fmt(x)} {fmt(y)}' for x,y in coords)+' Z'
    def region_path(self, poly, seg=0.02):
        """Param-space polygon (t,phi) → screen path d, clipped to visible."""
        g=poly.intersection(self.V)
        parts=[]
        for p in _iter_polys(g):
            p=p.segmentize(seg)
            parts.append(self._ring([self.b.project_pt(t,ph) for t,ph in p.exterior.coords]))
            for r in p.interiors: parts.append(self._ring([self.b.project_pt(t,ph) for t,ph in r.coords]))
        return ' '.join(parts)
    def line_path(self, line, seg=0.02):
        g=line.intersection(self.V)
        parts=[]
        for l in _iter_lines(g):
            l=l.segmentize(seg); c=list(l.coords)
            parts.append('M'+' L'.join(f'{fmt(x)} {fmt(y)}' for x,y in (self.b.project_pt(t,ph) for t,ph in c)))
        return ' '.join(parts)
    def fill(self, poly, color, opacity=1.0, extra=''):
        d=self.region_path(poly)
        if d: self.out.append(f'<path d="{d}" fill="{color}" fill-opacity="{opacity}" fill-rule="evenodd"{extra}/>')
    def stroke(self, line, color, width, opacity=1.0, extra='', cap='round'):
        d=self.line_path(line)
        if d: self.out.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-opacity="{opacity}" stroke-linecap="{cap}" stroke-linejoin="round"{extra}/>')
    def raw(self, s): self.out.append(s)

    # ── text on the surface ──
    def text(self, s, t0, phi0, size, color, opacity=1.0, angle=0.0, fontpath=ARIAL_BLACK, index=0,
             tracking=0.0, skew=0.0, anchor='middle', flip=False):
        """Place text in the tangent frame at (t0,phi0). `size` is in body units
        (same units as a, b). angle=0 runs the baseline along the meridian
        (+t direction), letters standing toward +phi."""
        g,adv=text_polys(s, fontpath, size, index, tracking, skew)
        if g.is_empty: return
        ox = -adv/2 if anchor=='middle' else (0 if anchor=='start' else -adv)
        oy = -size*0.36           # optically centre cap height on the baseline point
        ca,sa=math.cos(angle),math.sin(angle)
        s0=self.b.arc_of_t(t0)
        def mp(x,y):
            x+=ox; y+=oy
            if flip: x,y=-x,-y
            u=-(x*ca-y*sa); v=x*sa+y*ca   # baseline runs from the far tip toward the near one
            t=self.b.t_of_arc(s0+u)
            r=max(self.b.b*math.sin(t),1e-6)
            return (t, phi0-v/r)          # letters stand toward -phi (screen-up at the front)
        polys=[]
        for p in _iter_polys(g):
            p=p.segmentize(size*0.08)
            ext=[mp(x,y) for x,y in p.exterior.coords]
            ints=[[mp(x,y) for x,y in r.coords] for r in p.interiors]
            q=Polygon(ext,ints).buffer(0)
            if not q.is_empty: polys.append(q)
        if polys: self.fill(unary_union(polys), color, opacity)

    # ── shading layers ──
    def silhouette_path(self):
        return self._ring(self.b.silhouette())
    def shade(self, light=(-0.42,-0.40), form=0.62, rim=0.30, spec=0.55, spec_r=0.34, rim_light=0.45, outline=0.35,
              body_clip=None):
        cx,cy,rmaj,rmin,ang=self.b.ellipse_fit()
        cid=self.uid('clip')
        self.defs.append(f'<clipPath id="{cid}"><path d="{self.silhouette_path()}"/></clipPath>')
        # gradient space: unit circle mapped onto the projected ellipse
        tf=f'translate({fmt(cx)} {fmt(cy)}) rotate({ang:.1f}) scale({fmt(rmaj)} {fmt(rmin)})'
        lx,ly=light   # highlight point in the unit disc (rotated frame)
        fid,rid,sid,gid,lid=self.uid('form'),self.uid('rim'),self.uid('spec'),self.uid('rimlt'),self.uid('rimlin')
        self.defs.append(
            f'<radialGradient id="{fid}" gradientUnits="userSpaceOnUse" cx="{lx}" cy="{ly}" r="1.55" gradientTransform="{tf}">'
            f'<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.42" stop-color="#000" stop-opacity="{form*0.22:.3f}"/>'
            f'<stop offset="0.78" stop-color="#000" stop-opacity="{form*0.68:.3f}"/><stop offset="1" stop-color="#000" stop-opacity="{form:.3f}"/></radialGradient>')
        self.defs.append(
            f'<radialGradient id="{rid}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="{tf}">'
            f'<stop offset="0.72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="{rim:.3f}"/></radialGradient>')
        self.defs.append(
            f'<radialGradient id="{sid}" gradientUnits="userSpaceOnUse" cx="{lx*1.05}" cy="{ly*1.05}" r="{spec_r}" gradientTransform="{tf}">'
            f'<stop offset="0" stop-color="#fff" stop-opacity="{spec:.3f}"/><stop offset="0.45" stop-color="#fff" stop-opacity="{spec*0.35:.3f}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>')
        # rim light: bright stroke along the far limb only
        self.defs.append(
            f'<linearGradient id="{lid}" gradientUnits="userSpaceOnUse" x1="{lx}" y1="{ly}" x2="{-lx}" y2="{-ly}" gradientTransform="{tf}">'
            f'<stop offset="0.35" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="{rim_light:.3f}"/></linearGradient>')
        sp=self.silhouette_path()
        self.out.append(f'<g clip-path="url(#{cid})">')
        self.out.append(f'<path d="{sp}" fill="url(#{fid})"/>')
        self.out.append(f'<path d="{sp}" fill="url(#{rid})"/>')
        self.out.append(f'<path d="{sp}" fill="url(#{sid})"/>')
        self.out.append(f'<path d="{sp}" fill="none" stroke="url(#{lid})" stroke-width="7"/>')
        self.out.append('</g>')
        self.out.append(f'<path d="{sp}" fill="none" stroke="#000" stroke-opacity="{outline}" stroke-width="1.6"/>')
        return cid

    def leather(self, cid, amount=0.10, freq=0.9, seed=3):
        fid=self.uid('lth')
        self.defs.append(
            f'<filter id="{fid}" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="{freq}" numOctaves="2" seed="{seed}"/>'
            f'<feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1 0"/></filter>')
        self.out.append(f'<g clip-path="url(#{cid})" opacity="{amount}" style="mix-blend-mode:multiply"><rect x="0" y="0" width="{self.W}" height="{self.H}" filter="url(#{fid})"/></g>')

    def svg(self, label, note):
        return (f'<?xml version="1.0" encoding="UTF-8"?>\n<!--\n  {note}\n\n  Sport-ball fallback (watermarks.ts), shown when a competition badge cannot be\n'
                f'  fetched, and as the league mark for leagues without one.\n\n  Greyscale with alpha, used WITHOUT the mono filter. Rendered from a 3D model:\n'
                f'  every panel, seam and letter is placed on the surface and projected, then\n  shaded with gradients aligned to the silhouette. Light from the upper left.\n'
                f'  On a dark card the lit body carries the form; on a light card the dark\n  panels and shadow do — the two readings of the reference photograph.\n\n'
                f'  viewBox is the artwork\'s tight bounding box, so padRight is 0%.\n-->\n'
                f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.W} {self.H}" width="{self.W}" height="{self.H}" role="img" aria-label="{label}">\n'
                f'  <defs>\n    ' + '\n    '.join(self.defs) + '\n  </defs>\n  ' + '\n  '.join(self.out) + '\n</svg>\n')

# ───────────────────────── param-space shape helpers ─────────────────────────
def band_phi(phi_a, phi_b, t_a=0.0, t_b=math.pi, phi0=0.0, n=80):
    """Region between two meridians (relative to phi0), latitudes t_a..t_b."""
    ts=np.linspace(t_a,t_b,n)
    return Polygon([(t,phi0+phi_a) for t in ts]+[(t,phi0+phi_b) for t in ts[::-1]])

def cap(t_edge, phi0, n=160, wave=None):
    """Region from the tip t=0 to a (possibly wavy) latitude t_edge(phi)."""
    phis=np.linspace(phi0-math.pi, phi0+math.pi, n)
    edge=[(t_edge(ph-phi0) if callable(t_edge) else t_edge, ph) for ph in phis]
    return Polygon([(0.0,phi0-math.pi)]+edge+[(0.0,phi0+math.pi)])

def cap_far(t_edge, phi0, n=160):
    phis=np.linspace(phi0-math.pi, phi0+math.pi, n)
    edge=[(t_edge(ph-phi0) if callable(t_edge) else t_edge, ph) for ph in phis]
    return Polygon([(math.pi,phi0-math.pi)]+edge+[(math.pi,phi0+math.pi)])

def meridian(phi, t_a=0.0, t_b=math.pi, n=120):
    return LineString([(t,phi) for t in np.linspace(t_a,t_b,n)])

def parallel(t, phi0, n=200):
    return LineString([(t,ph) for ph in np.linspace(phi0-math.pi, phi0+math.pi, n)])

def curve(fn, u0, u1, n=200):
    return LineString([fn(u) for u in np.linspace(u0,u1,n)])

def strip(fn_lo, fn_hi, u0, u1, n=160):
    us=np.linspace(u0,u1,n)
    return Polygon([fn_lo(u) for u in us]+[fn_hi(u) for u in us[::-1]])

# ───────────────────────── 3D features (spheres, polyhedra) ─────────────────────────
def slerp_arc(p, q, n=16):
    p=np.asarray(p,float); q=np.asarray(q,float)
    p=p/np.linalg.norm(p); q=q/np.linalg.norm(q)
    om=math.acos(max(-1,min(1,float(p@q))))
    if om<1e-9: return [p]
    return [(math.sin((1-u)*om)*p+math.sin(u*om)*q)/math.sin(om) for u in np.linspace(0,1,n)]

def _clip_ring(ring, nrm, eps=1e-9):
    """Sutherland–Hodgman against the half-space p·nrm >= 0 (body frame)."""
    out=[]; n=len(ring)
    for i in range(n):
        a=ring[i]; b=ring[(i+1)%n]
        da=float(a@nrm); db=float(b@nrm)
        if da>=-eps: out.append(a)
        if (da>=-eps) != (db>=-eps):
            u=da/(da-db); out.append(a+(b-a)*u)
    return out

def _clip_line(pts, nrm, eps=1e-9):
    segs=[]; cur=[]
    for i in range(len(pts)-1):
        a=pts[i]; b=pts[i+1]; da=float(a@nrm); db=float(b@nrm)
        if da>=-eps and db>=-eps:
            if not cur: cur.append(a)
            cur.append(b)
        elif da>=-eps and db<-eps:
            if not cur: cur.append(a)
            cur.append(a+(b-a)*(da/(da-db))); segs.append(cur); cur=[]
        elif da<-eps and db>=-eps:
            cur=[a+(b-a)*(da/(da-db)), b]
    if len(cur)>1: segs.append(cur)
    return segs

def _body_nrm(body):
    vx,vy,vz=body.v; return np.array([vx/body.a**2, vy/body.b**2, vz/body.b**2])

def _proj3(body, p):
    q=body.R@p; return (body.cx+body.s*q[0], body.cy-body.s*q[1])

def scene_fill3d(self, rings, color, opacity=1.0, extra=''):
    nrm=_body_nrm(self.b); parts=[]
    for ring in rings:
        r=_clip_ring([np.asarray(p,float) for p in ring], nrm)
        if len(r)>=3: parts.append(self._ring([_proj3(self.b,p) for p in r]))
    if parts: self.out.append(f'<path d="{" ".join(parts)}" fill="{color}" fill-opacity="{opacity}" fill-rule="evenodd"{extra}/>')

def scene_stroke3d(self, pts, color, width, opacity=1.0, extra='', cap='round'):
    nrm=_body_nrm(self.b); parts=[]
    for seg in _clip_line([np.asarray(p,float) for p in pts], nrm):
        parts.append('M'+' L'.join(f'{fmt(x)} {fmt(y)}' for x,y in (_proj3(self.b,p) for p in seg)))
    if parts: self.out.append(f'<path d="{" ".join(parts)}" fill="none" stroke="{color}" stroke-width="{width}" stroke-opacity="{opacity}" stroke-linecap="{cap}" stroke-linejoin="round"{extra}/>')

Scene.fill3d=scene_fill3d; Scene.stroke3d=scene_stroke3d

def sphere_pt(t, phi): return np.array([math.cos(t), math.sin(t)*math.cos(phi), math.sin(t)*math.sin(phi)])

def truncated_icosahedron():
    """Unit-sphere vertices, pentagon rings, hexagon rings (arc-sampled rings are built by caller)."""
    g=(1+5**0.5)/2
    base=[(0,1,3*g),(1,2+g,2*g),(g,2,2*g+1)]
    V=[]
    for (a,b,c) in base:
        for sa in (1,-1):
            for sb in (1,-1):
                for sc in (1,-1):
                    x,y,z=a*sa,b*sb,c*sc
                    for perm in ((x,y,z),(y,z,x),(z,x,y)):
                        V.append(perm)
    V=np.unique(np.round(np.array(V,float),6),axis=0)
    V=V/np.linalg.norm(V,axis=1,keepdims=True)
    pc=[]
    for (a,b,c) in [(0,1,g)]:
        for sb in (1,-1):
            for sc in (1,-1):
                x,y,z=a,b*sb,c*sc
                for perm in ((x,y,z),(y,z,x),(z,x,y)): pc.append(perm)
    hc=[(sx,sy,sz) for sx in (1,-1) for sy in (1,-1) for sz in (1,-1)]
    for sb in (1,-1):
        for sc in (1,-1):
            x,y,z=0,sb/g,sc*g
            for perm in ((x,y,z),(y,z,x),(z,x,y)): hc.append(perm)
    def ring(center,k):
        c=np.array(center,float); c/=np.linalg.norm(c)
        idx=np.argsort(-(V@c))[:k]; pts=V[idx]
        # sort around the centre
        e1=np.cross(c,[0.3,0.5,0.8]); e1/=np.linalg.norm(e1); e2=np.cross(c,e1)
        ang=[math.atan2(float(p@e2),float(p@e1)) for p in pts]
        return [pts[i] for i in np.argsort(ang)]
    return [ring(c,5) for c in pc], [ring(c,6) for c in hc]

def arc_ring(ring, n=10):
    out=[]
    for i in range(len(ring)):
        out+=slerp_arc(ring[i], ring[(i+1)%len(ring)], n)[:-1]
    return out

def rotmat(axis, ang):
    axis=np.asarray(axis,float); axis/=np.linalg.norm(axis)
    x,y,z=axis; c,s=math.cos(ang),math.sin(ang); C=1-c
    return np.array([[c+x*x*C, x*y*C-z*s, x*z*C+y*s],[y*x*C+z*s, c+y*y*C, y*z*C-x*s],[z*x*C-y*s, z*y*C+x*s, c+z*z*C]])
