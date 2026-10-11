const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

export function result(data,status=200) {
  return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
export function problem(error,status=400){return result({error},status)}
export function parseImages(images){
  if(!Array.isArray(images))return [];
  if(images.length>6)throw Object.assign(new Error('الحد الأقصى 6 صور لكل درس'),{status:413});
  let sum=0;
  return images.map((image,i)=>{
    const uri=String(image?.data||'');
    const match=uri.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if(!match)throw Object.assign(new Error('الصورة رقم '+(i+1)+' غير مدعومة'),{status:400});
    sum+=match[2].length;
    if(sum>3_600_000)throw Object.assign(new Error('حجم الصور كبير. صغّر عدد الصور أو دقتها.'),{status:413});
    return {inline_data:{mime_type:match[1],data:match[2]}};
  });
}
export async function geminiJSON(prompt,images=[]){
  if(!process.env.GEMINI_API_KEY)throw Object.assign(new Error('الذكاء الاصطناعي غير مفعل بعد. يرجى التواصل مع إدارة الموقع.'),{status:503});
  const body={
    contents:[{role:'user',parts:[{text:prompt},...parseImages(images)]}],
    generationConfig:{responseMimeType:'application/json',maxOutputTokens:16384}
  };
  let reply;
  try {
    reply=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(MODEL)+':generateContent',{
      method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},
      body:JSON.stringify(body),signal:AbortSignal.timeout(55000)
    });
  }catch{
    throw Object.assign(new Error('تعذر الاتصال بخدمة الذكاء الاصطناعي. حاول مرة أخرى.'),{status:503});
  }
  if(!reply.ok){
    // Do not expose the Google error payload or API key to browser responses.
    // Distinguish configuration errors from quota and transient provider errors.
    let reasonCode='';
    try{
      const detail=await reply.json();
      reasonCode=String(detail?.error?.status||'').slice(0,50);
    }catch{}
    console.error('[Waraqa Gemini] request failed', {httpStatus:reply.status,code:reasonCode,model:MODEL});
    if(reply.status===429)throw Object.assign(new Error('خدمة Gemini وصلت للحد المتاح من الطلبات أو الاستهلاك. دي حصة Google، مش باقة ورقة. جرّب لاحقًا أو راجع حدود Gemini API.'),{status:429});
    if(reply.status===404)throw Object.assign(new Error('نموذج Gemini المحدد مش متاح لمفتاح المشروع. راجع إعداد GEMINI_MODEL في Vercel.'),{status:502});
    if(reply.status===401||reply.status===403)throw Object.assign(new Error('مفتاح Gemini غير مصرح له باستخدام الخدمة. راجع GEMINI_API_KEY في Vercel وGoogle AI Studio.'),{status:502});
    if(reply.status===400)throw Object.assign(new Error('Google رفضت إعدادات طلب Gemini. راجع إعداد GEMINI_MODEL وتفاصيل الخطأ في Vercel Logs.'),{status:502});
    throw Object.assign(new Error('خدمة Gemini غير متاحة مؤقتًا (رمز '+reply.status+'). حاول لاحقًا.'),{status:502});
  }
  const data=await reply.json();
  const raw=(data.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('\n');
  let cleaned=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  if(cleaned[0]!=='{'){const first=cleaned.indexOf('{'),last=cleaned.lastIndexOf('}');if(first>=0&&last>first)cleaned=cleaned.slice(first,last+1)}
  try{return JSON.parse(cleaned)}catch{
    throw Object.assign(new Error('التوليد لم يكتمل. قلل عدد الأسئلة وجرّب مرة أخرى.'),{status:502});
  }
}
export async function input(request){
  if(request.method!=='POST')throw Object.assign(new Error('طريقة الطلب غير مدعومة'),{status:405});
  const length=Number(request.headers.get('content-length')||0);
  if(length>4_100_000)throw Object.assign(new Error('حجم صور الدرس أكبر من المسموح'),{status:413});
  let data;
  try{data=await request.json()}catch{throw Object.assign(new Error('محتوى الطلب غير صالح'),{status:400})}
  return data;
}
export function fail(e){return problem(e?.message||'تعذر إكمال العملية الآن',e?.status||500)}
