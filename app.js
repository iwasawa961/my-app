import * as pdfjsLib from './vendor/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.mjs';
const $ = id => document.getElementById(id);
const fileInput=$('fileInput'),dropzone=$('dropzone'),preview=$('previewCanvas');
const pctx=preview.getContext('2d',{alpha:false}),editorPanel=$('editorPanel');
let pdfPage=null,fileBase='絵型',vectorPaths=[];
let boxes={front:{x:.48,y:.12,w:.46,h:.70},back:{x:.05,y:.42,w:.36,h:.50}},autoBoxes=null;

const mul=(m,n)=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
const pt=(m,x,y)=>({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]});
const cloneStyle=s=>({...s,dash:[...s.dash]});

function boxPixels(kind){const b=boxes[kind];return{x:b.x*preview.width,y:b.y*preview.height,w:b.w*preview.width,h:b.h*preview.height}}
function setBox(kind,next){
  next.w=Math.max(.06,Math.min(next.w,1-next.x));next.h=Math.max(.08,Math.min(next.h,1-next.y));
  next.x=Math.max(0,Math.min(next.x,1-next.w));next.y=Math.max(0,Math.min(next.y,1-next.h));boxes[kind]={...next};
  const el=$(kind+'Box');el.style.left=`${next.x*100}%`;el.style.top=`${next.y*100}%`;el.style.width=`${next.w*100}%`;el.style.height=`${next.h*100}%`;
}
function setAllBoxes(value){boxes=structuredClone(value);setBox('front',boxes.front);setBox('back',boxes.back)}

async function loadPdf(file){
  if(!file||!file.name.toLowerCase().endsWith('.pdf')){alert('PDFファイルを選択してください。');return}
  $('status').textContent='絵型の位置を解析しています…';
  try{
    const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
    pdfPage=await pdf.getPage(Math.min(2,pdf.numPages));fileBase=file.name.replace(/\.pdf$/i,'');
    const vp=pdfPage.getViewport({scale:1});preview.width=Math.round(vp.width);preview.height=Math.round(vp.height);
    vectorPaths=await extractVectorPaths(pdfPage,vp);
    autoBoxes=await detectBoxes(pdfPage,vp);setAllBoxes(autoBoxes);
    await pdfPage.render({canvasContext:pctx,viewport:vp,background:'white'}).promise;
    $('fileName').textContent=file.name;$('fileMeta').textContent=`${(file.size/1024).toFixed(0)} KB ・ ${pdf.numPages}ページ（最初の絵型を使用）`;
    dropzone.classList.add('hidden');$('fileRow').classList.remove('hidden');editorPanel.classList.remove('hidden');
    $('status').textContent='服全体が枠内に入り、注釈文字が枠外になるよう確認してください。';editorPanel.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){console.error(e);alert('PDFを読み込めませんでした。')}
}

async function extractVectorPaths(page,vp){
  const list=await page.getOperatorList(),O=pdfjsLib.OPS;let ctm=[1,0,0,1,0,0];
  let style={lineWidth:1,lineCap:0,lineJoin:0,miter:10,dash:[],dashOffset:0};const stack=[],out=[];
  for(let i=0;i<list.fnArray.length;i++){
    const fn=list.fnArray[i],a=list.argsArray[i]||[];
    if(fn===O.save)stack.push({ctm:[...ctm],style:cloneStyle(style)});
    else if(fn===O.restore){const s=stack.pop();if(s){ctm=s.ctm;style=s.style}}
    else if(fn===O.transform)ctm=mul(ctm,a);
    else if(fn===O.setLineWidth)style.lineWidth=Number(a[0]);
    else if(fn===O.setLineCap)style.lineCap=Number(a[0]);
    else if(fn===O.setLineJoin)style.lineJoin=Number(a[0]);
    else if(fn===O.setMiterLimit)style.miter=Number(a[0]);
    else if(fn===O.setDash){style.dash=Array.from(a[0]||[]);style.dashOffset=Number(a[1]||0)}
    else if(fn===O.constructPath){
      const paint=Number(a[0]),raw=a[1]?.[0],mm=a[2];if(!mm||!(raw instanceof Float32Array||Array.isArray(raw)))continue;
      const m=mul(vp.transform,ctm),corners=[pt(m,mm[0],mm[1]),pt(m,mm[0],mm[3]),pt(m,mm[2],mm[1]),pt(m,mm[2],mm[3])];
      const xs=corners.map(v=>v.x),ys=corners.map(v=>v.y);
      out.push({paint,data:Array.from(raw),matrix:m,style:cloneStyle(style),bbox:{x:Math.min(...xs),y:Math.min(...ys),r:Math.max(...xs),b:Math.max(...ys)}});
    }
  }
  return out;
}

async function detectBoxes(page,vp){
  const text=await page.getTextContent(),anchors={};
  for(const item of text.items){
    const s=(item.str||'').toUpperCase();if(!s.includes('FRONT')&&!s.includes('BACK'))continue;
    const m=pdfjsLib.Util.transform(vp.transform,item.transform),kind=s.includes('FRONT')?'front':'back';
    anchors[kind]={x:m[4]+Math.abs(item.width||40)/2,y:m[5]};
  }
  if(!anchors.front)anchors.front={x:vp.width*.66,y:vp.height*.10};if(!anchors.back)anchors.back={x:vp.width*.22,y:vp.height*.43};
  const close=Math.abs(anchors.front.x-anchors.back.x)<vp.width*.30;
  const make=(a,kind)=>{
    const w=vp.width*(close?.25:(kind==='front'?.48:.34));
    const center=a.x+vp.width*(close?.05:(kind==='front'?-.02:.15));
    const y=Math.max(vp.height*.10,a.y+14),h=Math.max(vp.height*.25,vp.height-y-7),x=Math.max(3,Math.min(vp.width-w-3,center-w*.5));
    return{x:x/vp.width,y:y/vp.height,w:w/vp.width,h:h/vp.height};
  };
  return{front:make(anchors.front,'front'),back:make(anchors.back,'back')};
}

function pathFromData(data){
  const p=new Path2D();for(let i=0;i<data.length;){const op=data[i++];
    if(op===0)p.moveTo(data[i++],data[i++]);else if(op===1)p.lineTo(data[i++],data[i++]);
    else if(op===2)p.bezierCurveTo(data[i++],data[i++],data[i++],data[i++],data[i++],data[i++]);
    else if(op===3)p.quadraticCurveTo(data[i++],data[i++],data[i++],data[i++]);else if(op===4)p.closePath();else break;
  }return p;
}
function selected(kind){
  const b=boxPixels(kind),tol=2;return vectorPaths.filter(p=>p.bbox.x>=b.x-tol&&p.bbox.y>=b.y-tol&&p.bbox.r<=b.x+b.w+tol&&p.bbox.b<=b.y+b.h+tol);
}
function bounds(paths){
  if(!paths.length)return null;return{x:Math.min(...paths.map(p=>p.bbox.x)),y:Math.min(...paths.map(p=>p.bbox.y)),r:Math.max(...paths.map(p=>p.bbox.r)),b:Math.max(...paths.map(p=>p.bbox.b))};
}
function drawPaths(g,paths,b,x,y,scale){
  g.save();g.translate(x-b.x*scale,y-b.y*scale);g.scale(scale,scale);
  for(const item of paths){
    const s=item.style,p=pathFromData(item.data);g.save();g.transform(...item.matrix);g.lineWidth=s.lineWidth||1;g.lineCap=['butt','round','square'][s.lineCap]||'butt';g.lineJoin=['miter','round','bevel'][s.lineJoin]||'miter';g.miterLimit=s.miter||10;g.setLineDash(s.dash);g.lineDashOffset=s.dashOffset;g.strokeStyle='#111';g.fillStyle='#111';
    if([20,21].includes(item.paint))g.stroke(p);else if([22,23].includes(item.paint))g.fill(p,item.paint===23?'evenodd':'nonzero');else if([24,25,26,27].includes(item.paint)){g.fill(p,[25,27].includes(item.paint)?'evenodd':'nonzero');g.stroke(p)}g.restore();
  }g.restore();
}
function makeOutput(q){
  const fp=selected('front'),bp=selected('back'),fb=bounds(fp),bb=bounds(bp);if(!fb||!bb)throw new Error('服の線が枠内にありません');
  const fw=fb.r-fb.x,fh=fb.b-fb.y,bw=bb.r-bb.x,bh=bb.b-bb.y,aspect=fh/fw;
  const targetH=Math.max(430,Math.min(560,380+85*aspect))*q,fs=targetH/fh,bs=targetH/bh,frontW=Math.ceil(fw*fs),backW=Math.ceil(bw*bs);
  const offset=Math.round(targetH*(aspect>1.2?.15:.39)),gap=Math.round(28*q),pad=Math.round(3*q);
  const out=document.createElement('canvas');out.width=frontW+backW+gap+pad*2;out.height=Math.ceil(targetH+offset+pad*2);
  const g=out.getContext('2d',{alpha:false});g.fillStyle='white';g.fillRect(0,0,out.width,out.height);drawPaths(g,fp,fb,pad,pad,fs);drawPaths(g,bp,bb,pad+frontW+gap,pad+offset,bs);return out;
}

async function downloadPng(){const button=$('downloadButton');button.disabled=true;$('status').textContent='絵型の線だけを抽出しています…';
  try{const out=makeOutput(Number($('qualitySelect').value)),blob=await new Promise(r=>out.toBlob(r,'image/png')),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${fileBase}_絵型.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('status').textContent=`保存しました（${out.width} × ${out.height} px）`}
  catch(e){console.error(e);$('status').textContent='枠内の絵型を認識できません。服全体を少し余裕をもって囲んでください。'}finally{button.disabled=false}}

function beginDrag(kind,e){e.preventDefault();const rect=$('canvasWrap').getBoundingClientRect(),start={x:e.clientX/rect.width,y:e.clientY/rect.height,b:{...boxes[kind]}},handle=e.target.dataset.handle;
  const move=ev=>{const dx=ev.clientX/rect.width-start.x,dy=ev.clientY/rect.height-start.y,n={...start.b};if(!handle){n.x+=dx;n.y+=dy}else{if(handle.includes('e'))n.w+=dx;if(handle.includes('s'))n.h+=dy;if(handle.includes('w')){n.x+=dx;n.w-=dx}if(handle.includes('n')){n.y+=dy;n.h-=dy}}setBox(kind,n)};
  const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
}

fileInput.addEventListener('change',()=>loadPdf(fileInput.files[0]));$('replaceButton').addEventListener('click',()=>fileInput.click());$('downloadButton').addEventListener('click',downloadPng);$('resetBoxes').addEventListener('click',()=>autoBoxes&&setAllBoxes(autoBoxes));
$('frontBox').addEventListener('pointerdown',e=>beginDrag('front',e));$('backBox').addEventListener('pointerdown',e=>beginDrag('back',e));
['dragenter','dragover'].forEach(n=>dropzone.addEventListener(n,e=>{e.preventDefault();dropzone.classList.add('dragover')}));['dragleave','drop'].forEach(n=>dropzone.addEventListener(n,e=>{e.preventDefault();dropzone.classList.remove('dragover')}));dropzone.addEventListener('drop',e=>loadPdf(e.dataTransfer.files[0]));setAllBoxes(boxes);
