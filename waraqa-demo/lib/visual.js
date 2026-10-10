// Strict, server-side schema for NEW educational diagrams, never arbitrary SVG/HTML.
// Source textbook photos are NEVER reused unless the teacher explicitly chooses them.
const KINDS=new Set(['rect','ellipse','circle','triangle','line','arrow','text']);
const COLORS=new Set(['mint','teal','blue','sky','green','sand','orange','purple','gray','ink','white','rose']);
const clamp=(value,min,max,fallback=0)=>{
 const n=Number(value);
 return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;
};
const word=(value,limit=50)=>String(value??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,limit);
export function normalizeVisual(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||!Array.isArray(v.elements))return null;
 const elements=v.elements.slice(0,22).map(e=>{
  if(!e||typeof e!=='object'||!KINDS.has(e.kind))return null;
  const kind=e.kind;
  const x=clamp(e.x,0,100,50),y=clamp(e.y,0,100,50);
  const w=clamp(e.w,4,94,22),h=clamp(e.h,4,94,20);
  const fill=COLORS.has(e.fill)?e.fill:'sky';
  const stroke=COLORS.has(e.stroke)?e.stroke:'ink';
  const label=word(e.label,65);
  if(kind==='text'&&!label)return null;
  if((kind==='line'||kind==='arrow')&&Math.abs(x-clamp(e.x2,0,100,50))+Math.abs(y-clamp(e.y2,0,100,50))<2)return null;
  return {kind,x,y,w,h,fill,stroke,label,x2:clamp(e.x2,0,100,50),y2:clamp(e.y2,0,100,50)};
 }).filter(Boolean);
 if(!elements.length)return null;
 return {title:word(v.title,95)||'رسم تعليمي',schematic:true,elements};
}