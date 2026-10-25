const S=2,C=170,R=80,CW=6*S,CH=11*S,W=C*CW,H=R*CH,T=24,ASP=W/H,FA=.82;
const $=id=>document.getElementById(id);
const hash=(x,y)=>{const s=Math.sin(x*127.1+y*311.7)*43758.5453;return s-Math.floor(s)};
const ss=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t)};
const clamp=x=>Math.min(1,Math.max(0,x));
const cl=(v,a,b)=>Math.min(b,Math.max(a,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const mk=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};

/* ---------- glyph atlases: letters binned by measured ink density ---------- */
const CAND=" .'`,:;-_~^\"!i|/\\()[]{}<>+=*?lItrjfxnuvczXYUJCLQ0OZmwqpdbkhao#MW&8%B@$";
const NB=40;
function makeAtlas(cw,ch,fs,stroke){
  const GL=[],GD=[],GI={},BIN=[],c=mk(cw,ch),x=c.getContext('2d',{willReadFrequently:true});
  x.font='bold '+fs+'px "Courier New",Consolas,monospace';x.textAlign='center';x.textBaseline='middle';
  let mx=1;
  for(const k of CAND){
    x.clearRect(0,0,cw,ch);x.fillStyle='#fff';x.fillText(k,cw/2,ch/2+.5);if(stroke){x.lineWidth=stroke;x.lineJoin='round';x.strokeStyle='#fff';x.strokeText(k,cw/2,ch/2+.5)}
    const d=x.getImageData(0,0,cw,ch).data,m=new Uint8Array(cw*ch);let s=0;
    for(let i=0;i<cw*ch;i++){m[i]=d[4*i+3];s+=m[i]}
    GI[k]=GL.length;GL.push(m);GD.push(s);mx=Math.max(mx,s);
  }
  for(let b=0;b<NB;b++)BIN.push([]);
  GD.forEach((s,i)=>BIN[Math.round(s/mx*(NB-1))].push(i));
  for(let b=1;b<NB;b++)if(!BIN[b].length){let k=1;while(b-k>=0&&b+k<NB&&!BIN[b-k].length&&!BIN[b+k].length)k++;BIN[b]=(b-k>=0&&BIN[b-k].length)?BIN[b-k]:BIN[Math.min(NB-1,b+k)]}
  if(!BIN[0].length)BIN[0]=[0];
  return{GL,GI,BIN}
}
const FCW=4*S,FCH=7*S,FC=Math.floor(W/FCW),FR=Math.floor(H/FCH);
const A1=makeAtlas(CW,CH,10*S),A2=makeAtlas(FCW,FCH,7*S,.6*S),GL=A1.GL,GI=A1.GI;
function pick(A,l,cx,cy,t){const b=Math.round(clamp(l)*(NB-1));if(b<1)return -1;const a=A.BIN[b];return a[Math.floor(hash(cx,cy+Math.floor(t*2))*a.length)]}

/* ---------- framebuffer ---------- */
const cv=$('cv'),ctx=cv.getContext('2d');cv.width=W;cv.height=H;
const FB=ctx.createImageData(W,H),fb=FB.data,u32=new Uint32Array(fb.buffer);
function put(cx,cy,gi,r,g,b,a){
  if(gi<0||cx<0||cy<0||cx>=C||cy>=R||a<=.01)return;
  const m=GL[gi],x0=cx*CW;a=Math.min(1,a)/255;
  for(let j=0;j<CH;j++){let p=((cy*CH+j)*W+x0)*4;const o=j*CW;
    for(let i=0;i<CW;i++,p+=4){const k=m[o+i]*a;if(k>.004){fb[p]+=(r-fb[p])*k;fb[p+1]+=(g-fb[p+1])*k;fb[p+2]+=(b-fb[p+2])*k}}}
}
function clearCell(cx,cy){for(let j=0;j<CH;j++){const p=(cy*CH+j)*W+cx*CW;u32.fill(0xFF0E0C0C,p,p+CW)}}
function putC(cx,cy,l,r,g,b,a,t){const gi=pick(A1,l,cx,cy,t);if(gi<0)return;const k=255/(Math.max(r,g,b)+1)*(.5+.5*l);put(cx,cy,gi,r*k,g*k,b*k,a)}
function put2(cx,cy,gi,r,g,b,a){
  if(gi<0||cx<0||cy<0||cx>=FC||cy>=FR||a<=.01)return;
  const m=A2.GL[gi],x0=cx*FCW;a=Math.min(1,a)/255;
  for(let j=0;j<FCH;j++){let p=((cy*FCH+j)*W+x0)*4;const o=j*FCW;
    for(let i=0;i<FCW;i++,p+=4){const k=m[o+i]*a;fb[p+3]=255;if(k>.004){fb[p]+=(r-fb[p])*k;fb[p+1]+=(g-fb[p+1])*k;fb[p+2]+=(b-fb[p+2])*k}}}
}
function clear2(cx,cy){for(let j=0;j<FCH;j++){const p=(cy*FCH+j)*W+cx*FCW;u32.fill(0xFF0E0C0C,p,p+FCW)}}
function putC2(cx,cy,l,r,g,b,a){const gi=pick(A2,l,cx,cy,0);if(gi<0)return;const k=255/(Math.max(r,g,b)+1)*(.6+.4*l);put2(cx,cy,gi,r*k,g*k,b*k,a)}
function boxBlur(L,w,h,r){const I=new Float64Array((w+1)*(h+1)),o=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)I[(y+1)*(w+1)+x+1]=L[y*w+x]+I[y*(w+1)+x+1]+I[(y+1)*(w+1)+x]-I[y*(w+1)+x];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const x0=Math.max(0,x-r),x1=Math.min(w,x+r+1),y0=Math.max(0,y-r),y1=Math.min(h,y+r+1);
    o[y*w+x]=(I[y1*(w+1)+x1]-I[y0*(w+1)+x1]-I[y1*(w+1)+x0]+I[y0*(w+1)+x0])/((x1-x0)*(y1-y0))}
  return o}
function unsharp(L,w,h,k){const o=new Float32Array(L.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0,n=0;
    for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const xx=x+i,yy=y+j;if(xx>=0&&yy>=0&&xx<w&&yy<h){s+=L[yy*w+xx];n++}}
    const v=L[y*w+x];o[y*w+x]=clamp(v+k*(v-s/n))}
  return o}

/* ---------- eye: prep + pupil detection ---------- */
let eyeC=null,eyeSmall=null,pup={x:0,y:0,r:10},lv={lo:0,hi:1};
function blur(g,w,h){const o=new Float32Array(g.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0,n=0;
    for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const xx=x+i,yy=y+j;if(xx>=0&&yy>=0&&xx<w&&yy<h){s+=g[yy*w+xx];n++}}
    o[y*w+x]=s/n}
  return o}
const RADII=[2,3,4,5,6,7,8,10,12,14];
function contrast(x,y,rr){
  const{g,w,h}=eyeSmall,sp=(a,b)=>g[cl(Math.round(b),0,h-1)*w+cl(Math.round(a),0,w-1)];
  let dm=sp(x,y);for(let k=0;k<6;k++){const a=k*Math.PI/3;dm+=sp(x+Math.cos(a)*rr*.6,y+Math.sin(a)*rr*.6)}dm/=7;
  const ring=[];for(let k=0;k<8;k++){const a=k*Math.PI/4;ring.push(sp(x+Math.cos(a)*rr*1.9,y+Math.sin(a)*rr*1.9))}
  ring.sort((p,q)=>p-q);
  return{c:(ring[1]+ring[2])/2-dm+.25*(1-dm),dm}
}
function bestR(x,y){let b=-9,br=4;for(const rr of RADII){const s=contrast(x,y,rr).c;if(s>b){b=s;br=rr}}return br}
function prepEye(im){
  const s=Math.min(1,1600/Math.max(im.width,im.height));
  eyeC=mk(Math.round(im.width*s),Math.round(im.height*s));eyeC.getContext('2d').drawImage(im,0,0,eyeC.width,eyeC.height);
  const w=96,h=Math.max(12,Math.round(96*eyeC.height/eyeC.width)),c=mk(w,h),x=c.getContext('2d',{willReadFrequently:true});
  x.drawImage(eyeC,0,0,w,h);const d=x.getImageData(0,0,w,h).data,g0=new Float32Array(w*h);
  for(let i=0;i<w*h;i++)g0[i]=(.299*d[4*i]+.587*d[4*i+1]+.114*d[4*i+2])/255;
  const srt=Array.from(g0).sort((p,q)=>p-q);lv={lo:srt[Math.floor(srt.length*.02)],hi:Math.max(srt[Math.floor(srt.length*.99)],srt[Math.floor(srt.length*.02)]+.1)};
  eyeSmall={g:blur(blur(g0,w,h),w,h),w,h};
  let best=-9,bx=w/2,by=h/2,brr=4;
  for(let yy=3;yy<h-3;yy++)for(let xx=3;xx<w-3;xx++)for(const rr of RADII){
    const k=contrast(xx,yy,rr),sc=k.c-.6*Math.hypot(xx/w-.5,(yy-h/2)/w);
    if(sc>best){best=sc;bx=xx;by=yy;brr=rr}}
  setPupil(bx,by,brr);
}
function setPupil(px,py,rr){const f=eyeC.width/eyeSmall.w;pup={x:(px+.5)*f,y:(py+.5)*f,r:(rr||bestR(px,py))*f};placeMk()}
function placeMk(){const m=$('mk');if(!m||!eyeC)return;m.style.left=(pup.x/eyeC.width*100)+'%';m.style.top=(pup.y/eyeC.height*100)+'%';m.style.width=(2*pup.r/eyeC.width*100)+'%'}

/* ---------- face: crop + prep ---------- */
let faceImg=null,eyeImg=null,fc={x:.5,y:.45},fz=1.3,faceG=null;
function faceCrop(){const iw=faceImg.width,ih=faceImg.height,h=Math.min(ih,iw/FA)/fz,w=h*FA;
  const cx=cl(fc.x*iw,w/2,iw-w/2),cy=cl(fc.y*ih,h/2,ih-h/2);return{x:cx-w/2,y:cy-h/2,w,h,iw,ih}}
function updFB(){const b=$('fb');if(!b||!faceImg)return;const k=faceCrop();
  b.style.left=(k.x/k.iw*100)+'%';b.style.top=(k.y/k.ih*100)+'%';b.style.width=(k.w/k.iw*100)+'%';b.style.height=(k.h/k.ih*100)+'%'}
/* Downscale in halving steps so big photos stay crisp instead of aliasing/blurring */
function scaleTo(img,sx,sy,sw,sh,tw,th){
  let cur=img,cx=sx,cy=sy,cw=sw,ch=sh;
  while(cw/2>tw*1.01&&ch/2>th*1.01){
    const nw=Math.max(tw,Math.round(cw/2)),nh=Math.max(th,Math.round(ch/2)),t=mk(nw,nh),tc=t.getContext('2d');
    tc.imageSmoothingEnabled=true;tc.imageSmoothingQuality='high';tc.drawImage(cur,cx,cy,cw,ch,0,0,nw,nh);
    cur=t;cx=0;cy=0;cw=nw;ch=nh}
  const o=mk(tw,th),oc=o.getContext('2d',{willReadFrequently:true});
  oc.imageSmoothingEnabled=true;oc.imageSmoothingQuality='high';oc.drawImage(cur,cx,cy,cw,ch,0,0,tw,th);
  return oc.getImageData(0,0,tw,th).data}

/* glyph masks as 0..1 floats + energy, built once for shape matching */
let FGL=null;
function faceGlyphs(){
  if(FGL)return FGL;
  let gm=0;FGL=A2.GL.map(m=>{const f=new Float32Array(m.length);let e=0,sm=0;for(let i=0;i<m.length;i++){f[i]=m[i]/255;e+=f[i]*f[i];sm+=f[i]}gm=Math.max(gm,sm/m.length);return{f,e:Math.max(e,1e-6),mean:sm/m.length}});
  FGL.gmax=gm;return FGL}

const TONE_TOL=.045; /* how far (0..1 ink) a glyph's average may stray from the photo's brightness */
function prepFace(){
  const rows=Math.round(FR*.94),cols=Math.round(rows*FA*FCH/FCW),k=faceCrop();
  const PW=cols*FCW,PH=rows*FCH,N=PW*PH;
  /* sample the photo at full ASCII pixel resolution (4x7 px per cell), not one sample per cell */
  const d=scaleTo(faceImg,k.x,k.y,k.w,k.h,PW,PH);
  let P=new Float32Array(N);
  for(let i=0;i<N;i++)P[i]=(.299*d[4*i]+.587*d[4*i+1]+.114*d[4*i+2])/255;
  const sm=[];for(let y=Math.floor(PH*.12);y<PH*.88;y+=3)for(let x=Math.floor(PW*.2);x<PW*.8;x+=3)sm.push(P[y*PW+x]);sm.sort((p,q)=>p-q);const lo=sm[Math.floor(sm.length*.02)],hi=Math.max(sm[Math.floor(sm.length*.995)],lo+.1);
  for(let i=0;i<N;i++)P[i]=Math.pow(clamp((P[i]-lo)/(hi-lo)),.6);
  const big=boxBlur(P,PW,PH,Math.round(PH/12));
  for(let i=0;i<N;i++)P[i]=clamp(P[i]+.7*(P[i]-big[i]));
  P=unsharp(P,PW,PH,.6);
  const G=faceGlyphs(),NG=G.length,n=FCW*FCH,gi=new Int16Array(cols*rows),col=new Uint8ClampedArray(cols*rows*3),T=new Float32Array(n);
  for(let cy=0;cy<rows;cy++)for(let cx=0;cx<cols;cx++){
    /* cell colour = average photo colour, kept at full intensity; brightness comes from the glyph */
    let r=0,g=0,b=0,o=0;
    for(let j=0;j<FCH;j++)for(let i=0;i<FCW;i++){
      const p=(cy*FCH+j)*PW+cx*FCW+i;r+=d[4*p];g+=d[4*p+1];b+=d[4*p+2];T[o++]=P[p]}
    r/=n;g/=n;b/=n;const mx=Math.max(r,g,b,1);
    let fr=.85*r/mx+.15,fg=.85*g/mx+.15,fb2=.85*b/mx+.15;
    const lf=.299*fr+.587*fg+.114*fb2;
    for(let i=0;i<n;i++)T[i]=Math.min(1,T[i]/lf)*G.gmax;
    /* 1) tone: only glyphs whose average ink matches the cell's brightness are allowed
       2) shape: of those, pick the one whose ink pattern best follows the 4x7 pixel pattern */
    let mT=0;for(let i=0;i<n;i++)mT+=T[i];mT/=n;
    let best=0,be=1e9,near=0,nd=1e9;
    for(let q=0;q<NG;q++){
      const dm=Math.abs(G[q].mean-mT);
      if(dm<nd){nd=dm;near=q}
      if(dm>TONE_TOL)continue;
      const f=G[q].f;let e=0;for(let i=0;i<n;i++){const v=f[i]-T[i];e+=v*v}
      if(e<be){be=e;best=q}}
    if(be>=1e9)best=near;
    const ci=cy*cols+cx;gi[ci]=best;const bs=1;
    col[3*ci]=255*fr*bs;col[3*ci+1]=255*fg*bs;col[3*ci+2]=255*fb2*bs}
  faceG={cols,rows,gi,col}
}

/* ---------- UI ---------- */
const readImg=f=>new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src=fr.result};fr.onerror=rej;fr.readAsDataURL(f)});
const chk=()=>{$('go').disabled=!(eyeImg&&faceImg)||updGoX()};
const rel=(ev)=>{const r=ev.target.getBoundingClientRect();return[cl((ev.clientX-r.left)/r.width,0,1),cl((ev.clientY-r.top)/r.height,0,1)]};
$('c1').onclick=()=>$('f1').click();$('c2').onclick=()=>$('f2').click();
$('f1').onchange=async e=>{const f=e.target.files[0];if(!f)return;
  try{eyeImg=await readImg(f);prepEye(eyeImg);
    $('d1').innerHTML='<span class="wrap"><img id="pe" src="'+eyeImg.src+'" alt="Eye"><span id="mk"></span></span>';placeMk();$('c1').style.display='block';
    $('pe').onclick=ev=>{const[fx,fy]=rel(ev);setPupil(fx*(eyeSmall.w-1),fy*(eyeSmall.h-1));ev.preventDefault();ev.stopPropagation()};
  }catch(err){eyeImg=null}chk()};
$('f2').onchange=async e=>{const f=e.target.files[0];if(!f)return;
  try{faceImg=await readImg(f);fc={x:.5,y:.45};
    $('d2').innerHTML='<span class="wrap"><img id="pf" src="'+faceImg.src+'" alt="Face"><span id="fb"></span></span>';$('sl').style.display='flex';$('c2').style.display='block';updFB();
    $('pf').onclick=ev=>{const[fx,fy]=rel(ev);fc={x:fx,y:fy};updFB();ev.preventDefault();ev.stopPropagation()};
  }catch(err){faceImg=null}chk()};
$('fz').oninput=e=>{fz=+e.target.value;updFB()};

/* ---------- renderer ---------- */
const s4c=mk(C*4,R*4),s4=s4c.getContext('2d');s4.imageSmoothingQuality='high';
const s1c=mk(C,R),s1=s1c.getContext('2d',{willReadFrequently:true});s1.imageSmoothingQuality='high';
const lumGrid=new Float32Array(C*R);
const STARS=[];for(let i=0;i<230;i++)STARS.push({x:(hash(i,1)-.5)*1.7,y:(hash(i,2)-.5)*.98,b:.35+.65*hash(i,3)});
const G_DOT=GI['.'],G_PLUS=GI['+'],G_STAR=GI['*'],G_H=GI['-'],G_V=GI['|'];

/* ---------- face drawing (cached once it reaches full size) ---------- */
let faceCache=null;
function drawFace(fs,g){
  const{cols,rows,gi,col}=faceG,dc=cols*fs,dr=rows*fs;
  const x0=Math.floor(FC/2-dc/2),x1=Math.ceil(FC/2+dc/2),y0=Math.floor(FR/2-dr/2),y1=Math.ceil(FR/2+dr/2);
  for(let cy=y0;cy<=y1;cy++)for(let cx=x0;cx<=x1;cx++){
    if(cx<0||cy<0||cx>=FC||cy>=FR)continue;
    const u=(cx+.5-FC/2)/dc+.5,v=(cy+.5-FR/2)/dr+.5;
    if(u<0||u>=1||v<0||v>=1)continue;
    const ax=Math.abs(2*u-1),ay=Math.abs(2*v-1),m=1-ss(.82,1.0,Math.pow(ax*ax*ax+ay*ay*ay,1/3));
    if(m<.04)continue;
    const k=Math.floor(v*rows)*cols+Math.floor(u*cols);
    if(m>.35)clear2(cx,cy);
    put2(cx,cy,gi[k],col[3*k],col[3*k+1],col[3*k+2],g*m);
  }
}
function buildFaceCache(){
  u32.fill(0);drawFace(1,1);faceCache=u32.slice();
  const{rows}=faceG;faceCache.y0=Math.max(0,(Math.floor(FR/2-rows/2)-1)*FCH);faceCache.y1=Math.min(H,(Math.ceil(FR/2+rows/2)+2)*FCH);
}
function blitFace(g){
  const c=faceCache,a=Math.min(1,g),i0=c.y0*W,i1=c.y1*W;
  if(a>.999){for(let i=i0;i<i1;i++){const v=c[i];if(v>>>24)u32[i]=v}return}
  for(let i=i0;i<i1;i++){const v=c[i];if(!(v>>>24))continue;const p=i*4;
    fb[p]+=((v&255)-fb[p])*a;fb[p+1]+=(((v>>>8)&255)-fb[p+1])*a;fb[p+2]+=(((v>>>16)&255)-fb[p+2])*a}
}

function frame(t){
  u32.fill(0xFF0E0C0C);
  const gf=ss(0,.6,t)*(1-ss(21.8,23.6,t));
  const zp=ss(6.5,13.2,t),ez=zp*zp*(3-2*zp);
  const ew=eyeC.width,eh=eyeC.height,rw0=Math.min(ew,eh*ASP)*(1-.04*ss(0,6.5,t));
  const rwE=Math.max(6,Math.min(rw0,pup.r*1.15)),rw=rw0*Math.pow(rwE/rw0,zp),rh=rw/ASP;
  const cxv=lerp(ew/2,pup.x,ez),cyv=lerp(eh/2,pup.y,ez);
  let sx0=cxv-rw/2,sy0=cyv-rh/2;
  sx0=lerp(cl(sx0,0,Math.max(0,ew-rw)),sx0,zp);sy0=lerp(cl(sy0,0,Math.max(0,eh-rh)),sy0,zp);
  s4.fillStyle='#000';s4.fillRect(0,0,C*4,R*4);s4.drawImage(eyeC,sx0,sy0,rw,rh,0,0,C*4,R*4);
  s1.drawImage(s4c,0,0,C,R);
  const d=s1.getImageData(0,0,C,R).data,eyeA=1-ss(9.5,13,t),rev=ss(0,2.4,t)*1.05;
  const L0=new Float32Array(C*R);
  for(let i=0;i<C*R;i++)L0[i]=Math.pow(clamp(((.299*d[4*i]+.587*d[4*i+1]+.114*d[4*i+2])/255-lv.lo)/(lv.hi-lv.lo)),.9);
  const L=unsharp(L0,C,R,.9);
  for(let i=0;i<C*R;i++)lumGrid[i]=L[i];
  if(eyeA>.02)for(let cy=0;cy<R;cy++)for(let cx=0;cx<C;cx++){
    const i=cy*C+cx;if(hash(cx,cy)>rev)continue;
    putC(cx,cy,L[i],d[4*i],d[4*i+1],d[4*i+2],gf*eyeA,t);
  }
  /* stars appear where the view is dark (the pupil) */
  const sv=ss(7,10.5,t),scl=1+.02*Math.max(0,t-6);
  for(let i=0;i<STARS.length;i++){
    const s=STARS[i],cx=Math.floor((s.x*scl*H+W/2)/CW),cy=Math.floor((s.y*scl*H+H/2)/CH);
    if(cx<0||cy<0||cx>=C||cy>=R)continue;
    const vis=1-ss(.1,.3,lumGrid[cy*C+cx])*eyeA,bb=s.b*(.6+.4*Math.sin(t*3+i*5)),a=gf*sv*vis*clamp(bb+.2);
    if(a<.02)continue;
    put(cx,cy,bb>.75?G_STAR:(bb>.5?G_PLUS:G_DOT),255,255,255,a);
    if(s.b>.6){const n=1+Math.floor(s.b*3);
      for(let k=1;k<=3*n;k++){const f=a*(1-k/(3*n+1));put(cx-k,cy,G_H,255,255,255,f);put(cx+k,cy,G_H,255,255,255,f)}
      for(let k=1;k<=n+1;k++){const f=a*(1-k/(n+2));put(cx,cy-k,G_V,255,255,255,f);put(cx,cy+k,G_V,255,255,255,f)}}
  }
  /* the face, as fine-grained ASCII from photo #2 */
  const fs=ss(12.2,15.6,t),fa=ss(12,14.2,t);
  if(!art&&fs>.01&&faceG){if(fs>.999&&faceCache)blitFace(gf*fa);else drawFace(fs,gf*fa)}
  ctx.putImageData(FB,0,0);
  if(art&&fs>.01)drawArt(fs,gf*fa);
}

let t0=0,running=false;
function loop(now){if(!running)return;frame(((now-t0)/1000)%T);requestAnimationFrame(loop)}
function start(){$('setup').style.display='none';$('stage').style.display='flex';t0=performance.now();if(!running){running=true;requestAnimationFrame(loop)}}
$('go').onclick=async()=>{if(genre){const ok=await generateArt();if(!ok)return}else art=null;prepFace();buildFaceCache();start()};
$('goAscii').onclick=()=>{art=null;prepFace();buildFaceCache();start()};
$('rp').onclick=()=>{t0=performance.now()};
$('bk').onclick=()=>{running=false;$('stage').style.display='none';$('setup').style.display='flex'};
$('rec').onclick=()=>{
  try{
    if(!window.MediaRecorder){alert('Recording is not supported in this browser.');return}
    const mt=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';
    const mr=new MediaRecorder(cv.captureStream(30),{mimeType:mt,videoBitsPerSecond:6e6}),ch=[];
    mr.ondataavailable=e=>{if(e.data.size)ch.push(e.data)};
    mr.onstop=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(ch,{type:'video/webm'}));a.download='eye-to-face.webm';a.click()};
    t0=performance.now();mr.start();setTimeout(()=>mr.stop(),T*1000);
  }catch(err){alert('Recording failed in this environment.')}
};

/* ---------- Story genre + AI artwork through the secure backend ----------
   The browser never sees an API key. It POSTs {genre, photo} to /api/generate; the server
   owns the prompts, calls Gemini and returns a genuinely generated image. */
const GENRE_NAMES=['Dark Romance','Fantasy','Science Fiction','Romance','Mystery','Thriller','Horror','Historical Fiction','Contemporary Fiction','Literary Fiction','Dystopian','Action & Adventure','Magical Realism'];
const API=String(window.E2F_API_BASE||'').replace(/\/$/,'');
let genre=null,art=null,genBusy=false,coolUntil=0,coolTimer=null,ctl=null,svcOk=null;
const status=(m,kind)=>{const s=$('gstat');s.textContent=m||'';s.className=kind||''};
function updGoX(){return genBusy||Date.now()<coolUntil||(!!genre&&!$('cons').checked)}
const GO_LABEL='Generate';
function setCool(sec){
  clearInterval(coolTimer);coolUntil=Date.now()+sec*1000;
  const t=()=>{const left=Math.ceil((coolUntil-Date.now())/1000);
    if(left<=0){clearInterval(coolTimer);coolUntil=0;$('go').textContent=GO_LABEL;$('mbNew').disabled=false;chk();return}
    $('go').textContent='Try again in '+left+'s';$('mbNew').disabled=true;chk()};
  t();coolTimer=setInterval(t,1000)}

/* the reference: the girl's whole photo, downscaled, as JPEG */
function refBlob(){return new Promise((res,rej)=>{const s=Math.min(1,1280/Math.max(faceImg.width,faceImg.height)),c=mk(Math.round(faceImg.width*s),Math.round(faceImg.height*s));c.getContext('2d').drawImage(faceImg,0,0,c.width,c.height);c.toBlob(b=>b?res(b):rej(new Error('photo')),'image/jpeg',.9)})}
const b64=b=>new Promise((res,rej)=>{const f=new FileReader();f.onload=()=>res(String(f.result).split(',')[1]);f.onerror=rej;f.readAsDataURL(b)});
const loadImg=b=>new Promise((res,rej)=>{const u=URL.createObjectURL(b),im=new Image();im.onload=()=>res(im);im.onerror=()=>rej(new Error('decode'));im.src=u;im.dataset.u=u});

const STAGES=[[0,'Preparing your photo…'],[2,'Sending it to the AI studio…'],[6,'The art director is writing your scene plan…'],[16,'Painting your moodboard. This usually takes 20 to 60 seconds…'],[60,'Still painting. Detailed artwork can take a little longer…'],[100,'Almost there. Thanks for waiting…']];
/* turn any failure into one calm sentence + optional cooldown */
function describe(e){
  if(e&&e.api){const a=e.api;let m=a.message||'Something went wrong. Please try again.';
    const wait=(a.code=='rate_limited'||a.code=='busy'||a.code=='upstream_unavailable')&&a.retryAfter?Math.min(a.retryAfter,600):0;
    return{m,wait,retry:!['daily_cap','not_configured'].includes(a.code)}}
  if(e&&e.name=='TimeoutError')return{m:'This is taking too long. Please try again.',wait:0,retry:true};
  if(typeof navigator!=='undefined'&&navigator.onLine===false)return{m:'You appear to be offline. Check your connection and try again.',wait:0,retry:true};
  if(e&&e.message=='photo')return{m:'Your photo could not be read. Please choose another one.',wait:0,retry:false};
  if(e&&e.message=='decode')return{m:'The generated image could not be displayed. Please try again.',wait:0,retry:true};
  if(e&&e.http)return{m:e.http>=500?'The service is temporarily unavailable. Please try again shortly.':'The request failed. Please try again.',wait:0,retry:true};
  return{m:'Cannot reach the server. Check your connection and try again.',wait:0,retry:true}}

async function generateArt(){
  if(genBusy||!genre||!faceImg)return false;
  genBusy=true;ctl=new AbortController();let cancelled=false,timedOut=false;
  const t0=Date.now(),timer=setTimeout(()=>{timedOut=true;ctl.abort()},150000);
  $('gcancel').onclick=()=>{cancelled=true;ctl.abort()};
  $('gprog').hidden=false;$('goAscii').hidden=true;$('go').textContent='Creating…';$('mbNew').disabled=true;
  document.querySelectorAll('.chip').forEach(b=>b.disabled=true);chk();
  const tick=setInterval(()=>{const s=Math.floor((Date.now()-t0)/1000);let m=STAGES[0][1];for(const[a,t]of STAGES)if(s>=a)m=t;status(m+'  ('+s+'s)')},500);
  status(STAGES[0][1]);
  try{
    const image=await b64(await refBlob());
    let res;try{res=await fetch(API+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({genre,image,mime:'image/jpeg'}),signal:ctl.signal})}
    catch(e){if(cancelled)throw{cancelled:1};if(timedOut)throw{name:'TimeoutError'};throw e}
    let j=null;try{j=await res.json()}catch(e){}
    if(!res.ok){if(j&&j.error)throw{api:j.error};throw{http:res.status}}
    if(!j||!j.image)throw{http:502};
    const blob=await fetch('data:'+(j.mime||'image/png')+';base64,'+j.image).then(r=>r.blob());
    const img=await loadImg(blob);
    if(art&&art.img.dataset.u)URL.revokeObjectURL(art.img.dataset.u);
    art={img,blob,quote:j.quote||'',genre};
    $('mb').src=img.dataset.u;$('mq').textContent=art.quote?'“'+art.quote+'”':'';$('mbBox').hidden=false;
    status('Your '+genre+' artwork is ready. Every press of Generate makes a brand-new one.','ok');return true;
  }catch(e){
    if(e&&e.cancelled){status('Cancelled.');return false}
    const d=describe(e);status((art?'Couldn\u2019t make a new one, your previous artwork is still below. ':'')+d.m,'err');
    if(d.retry){$('go').textContent='Try again';$('goAscii').hidden=false}
    if(d.wait)setCool(d.wait);
    return false;
  }finally{
    clearTimeout(timer);clearInterval(tick);genBusy=false;$('gprog').hidden=true;
    if(!coolUntil){$('mbNew').disabled=false;if($('go').textContent=='Creating…')$('go').textContent=GO_LABEL}
    sched();chk();
  }
}

function sched(){const has=!!faceImg;document.querySelectorAll('.chip').forEach(b=>b.disabled=!has||genBusy);
  $('mhint').textContent=has?'Pick a genre: the AI will generate a cinematic moodboard of you inside that world, then the eye zoom reveals it.':'Add your face photo (step 2) to unlock genres.';
  $('consWrap').hidden=!genre}
$('chips').innerHTML=GENRE_NAMES.map(n=>'<button class="chip" disabled>'+n.replace('&','&amp;')+'</button>').join('');
$('chips').onclick=e=>{const b=e.target.closest('.chip');if(!b||b.disabled)return;const same=genre===b.textContent;genre=same?null:b.textContent;art=null;$('mbBox').hidden=true;$('goAscii').hidden=true;
  if(!coolUntil)$('go').textContent=GO_LABEL;status('');document.querySelectorAll('.chip').forEach(x=>x.classList.toggle('on',x.textContent===genre));sched();chk()};
$('cons').onchange=chk;
$('mbNew').onclick=()=>{if(!updGoX())generateArt()};
async function saveBlob(blob,name){try{if(window.claude&&claude.use){const d=await claude.use('downloads');if(d){await d.save({filename:name,data:blob});return}}}catch(e){if(e&&e.code=='declined')return}
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4e4)}
$('mbSave').onclick=()=>{if(!art)return;const ext=/jpe?g/.test(art.blob.type)?'jpg':/webp/.test(art.blob.type)?'webp':'png';saveBlob(art.blob,'novel-moodboard-'+art.genre.toLowerCase().replace(/[^a-z]+/g,'-')+'.'+ext)};
/* friendly heads-up if the AI service is down; never blocks the ASCII animation */
fetch(API+'/api/health',{cache:'no-store'}).then(r=>r.json()).then(h=>{svcOk=!!(h&&h.ok&&h.ai);if(!svcOk)$('svc').hidden=false}).catch(()=>{svcOk=false;$('svc').hidden=false});
const _updFB=updFB;updFB=function(){_updFB();sched()};
$('f2').addEventListener('change',()=>setTimeout(()=>{art=null;$('mbBox').hidden=true;sched()},400));sched();
/* reveal the generated artwork as the camera exits the pupil (same timeline the ASCII face used) */
function drawArt(fs,g){const im=art.img,h=H*.97*(.18+.82*fs),w=h*im.width/im.height;ctx.save();ctx.globalAlpha=clamp(g);ctx.imageSmoothingQuality='high';ctx.shadowColor='#000';ctx.shadowBlur=50;ctx.drawImage(im,W/2-w/2,H/2-h/2,w,h);ctx.restore()}
