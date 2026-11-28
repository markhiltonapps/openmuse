# Previews of the animated Neddy scenes on the round watch (firmware/art/scenes): each loop at watch size, 12 frames a second, in the
# watch's colours, with sample words below. Usage: python3 firmware/tools/scene_preview.py <folder with clip_<n>.mp4> (needs ffmpeg, Pillow, numpy).
import subprocess, os, sys, glob
import numpy as np
from PIL import Image, ImageDraw, ImageFont
D=sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))   # a folder with clip_<n>.mp4
F='/usr/share/fonts/opentype/inter/'
def font(n,s): return ImageFont.truetype(F+n,s)
AMBER=(255,198,84); CORAL=(255,112,102); WHITE=(240,240,244); GREY=(150,156,162); CYAN=(120,222,255)
# clip, top line (colour, text), big line, small line
SCENES=[
 (0,(CORAL,'●  REC   MEETING'),'00:12:48','Neddy is taking notes'),
 (6,(CORAL,'●  REC   VOICE NOTE'),'00:00:37','Word for word'),
 (7,(CORAL,'●  REC   IDEA'),'00:01:05','Say it all, sorted later'),
 (5,(CORAL,'●  REC   DREAM'),'00:02:10','Sweet dreams'),
 (1,(CYAN,'DENVER'),'-4°','Snow · feels like -11°'),
 (2,(AMBER,'PHOENIX'),'112°','Excessive heat warning'),
 (4,(AMBER,'SAN DIEGO'),'78°','Sunny · high 81°'),
 (3,(CYAN,'SEATTLE'),'52°','Rain until 4 PM'),
]
SIZE=466; FPS=12
def frames(i):
    out=os.path.join(D,'pv',str(i)); os.makedirs(out,exist_ok=True)
    for f in glob.glob(out+'/*.png'): os.remove(f)
    subprocess.run(['ffmpeg','-v','error','-i',os.path.join(D,f'clip_{i}.mp4'),'-vf',f'fps={FPS},scale=-2:292:flags=lanczos',out+'/f_%03d.png'],check=True)
    return [Image.open(p).convert('RGB') for p in sorted(glob.glob(out+'/*.png'))]
def to565(im):
    a=np.asarray(im).astype(np.int32)
    a[...,0]=(a[...,0]>>3)<<3; a[...,1]=(a[...,1]>>2)<<2; a[...,2]=(a[...,2]>>3)<<3
    dark=a.sum(axis=2)<36; a[dark]=0          # the AMOLED's true black
    return Image.fromarray(a.astype(np.uint8))
def screen(fr,sc):
    img=Image.new('RGB',(SIZE,SIZE),(0,0,0)); d=ImageDraw.Draw(img)
    w,h=fr.size; img.paste(fr,((SIZE-w)//2,22))
    col,top=sc[1]
    f1=font('Inter-SemiBold.otf',20); f2=font('Inter-SemiBold.otf',54); f3=font('Inter-Regular.otf',22)
    def c(t,f,y,colr):
        tw=d.textlength(t,font=f); d.text(((SIZE-tw)/2,y),t,font=f,fill=colr)
    c(top,f1,318,col); c(sc[2],f2,340,WHITE); c(sc[3],f3,402,GREY)
    m=Image.new('L',(SIZE,SIZE),0); ImageDraw.Draw(m).ellipse((0,0,SIZE-1,SIZE-1),fill=255)
    out=Image.new('RGB',(SIZE,SIZE),(0,0,0)); out.paste(to565(img),(0,0),m); return out
def watch(scr,cell,bg):
    R=cell//2; im=Image.new('RGB',(cell,cell),bg); d=ImageDraw.Draw(im)
    d.ellipse((0,0,cell-1,cell-1),fill=(176,180,186),outline=(130,136,142),width=2)
    inner=cell-24; s=scr.resize((inner,inner),Image.LANCZOS)
    m=Image.new('L',(inner,inner),0); ImageDraw.Draw(m).ellipse((0,0,inner-1,inner-1),fill=255)
    im.paste(s,(12,12),m); return im
clips={}
for sc in SCENES:
    p=os.path.join(D,f'clip_{sc[0]}.mp4')
    if os.path.exists(p): clips[sc[0]]=frames(sc[0])
scenes=[s for s in SCENES if s[0] in clips]
n=min(len(clips[s[0]]) for s in scenes)
# one big preview of each scene, full watch size
for sc in scenes:
    fs=[watch(screen(clips[sc[0]][k],sc),SIZE+24,(18,24,32)) for k in range(n)]
    fs[0].save(os.path.join(D,f'watch_{sc[0]}.webp'),save_all=True,append_images=fs[1:],duration=int(1000/FPS),loop=0,quality=82)
# the grid of all of them
cell=300; cols=4; rows=(len(scenes)+cols-1)//cols; pad=16
grid=[]
for k in range(n):
    g=Image.new('RGB',(cols*cell+(cols+1)*pad,rows*cell+(rows+1)*pad),(18,24,32))
    for j,sc in enumerate(scenes):
        g.paste(watch(screen(clips[sc[0]][k],sc),cell,(18,24,32)),(pad+(j%cols)*(cell+pad),pad+(j//cols)*(cell+pad)))
    grid.append(g)
grid[0].save(os.path.join(D,'watch_grid.webp'),save_all=True,append_images=grid[1:],duration=int(1000/FPS),loop=0,quality=80)
grid[0].save(os.path.join(D,'watch_grid_still.png'))
print('scenes',len(scenes),'frames',n)
