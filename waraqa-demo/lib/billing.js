// Server-side Supabase REST helpers. Never import into browser code.
export function billingSettings(){
  const price=Number(process.env.SUBSCRIPTION_PRICE_EGP||0);
  const destination=String(process.env.INSTAPAY_DESTINATION||'').trim().slice(0,160);
  return {
    enabled:process.env.SUBSCRIPTION_ENABLED==='true',
    price:Number.isSafeInteger(price)&&price>0&&price<=100000?price:null,
    destination,
    paymentReady:!!(destination&&Number.isSafeInteger(price)&&price>0&&price<=100000)
  };
}
export function serviceConfig(){
  const url=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
  const key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||'');
  if(!/^https:\/\/[a-z0-9.-]+\.supabase\.co$/i.test(url)||!key)
    throw Object.assign(new Error('قاعدة بيانات الاشتراكات غير متصلة'),{status:503});
  return {url,key};
}
function adminHeaders(key,extra={}){
  return {
    apikey:key,
    ...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key}),
    ...extra
  };
}
export async function supabaseRest(path,{method='GET',body,headers={},expectJson=true}={}){
  const {url,key}=serviceConfig();
  const res=await fetch(url+'/rest/v1/'+path,{
    method,
    headers:adminHeaders(key,{Accept:'application/json',...headers,...(body&&typeof body==='object'&&!ArrayBuffer.isView(body)&&!(body instanceof Uint8Array)?{'Content-Type':'application/json'}:{})}),
    ...(body!=null?{body:typeof body==='string'?body:JSON.stringify(body)}:{}),
    signal:AbortSignal.timeout(12000)
  });
  const raw=await res.text();
  if(!res.ok)throw Object.assign(new Error('تعذر الاتصال ببيانات الاشتراكات. راجع تفعيل SQL.'),{status:503,detail:raw.slice(0,400)});
  if(!expectJson)return raw;
  try{return raw?JSON.parse(raw):null}catch{throw Object.assign(new Error('رد غير متوقع من قاعدة البيانات'),{status:503})}
}
export async function getSubscription(userId){
  const rows=await supabaseRest('teacher_subscriptions?select=trial_started_at,trial_ends_at,paid_until&user_id=eq.'+encodeURIComponent(userId)+'&limit=1');
  return Array.isArray(rows)?rows[0]||null:null;
}
export function subscriptionAccess(s,at=Date.now()){
  return !!s && Math.max(Date.parse(s.trial_ends_at)||0,Date.parse(s.paid_until)||0)>at;
}
export async function uploadProof(path,binary,mime){
  const {url,key}=serviceConfig();
  const res=await fetch(url+'/storage/v1/object/payment-proofs/'+path,{
    method:'POST',headers:adminHeaders(key,{'Content-Type':mime,'Cache-Control':'no-store','x-upsert':'false'}),
    body:binary,signal:AbortSignal.timeout(18000)
  });
  if(!res.ok)throw Object.assign(new Error('تعذر حفظ صورة الإيصال بصورة آمنة'),{status:503});
}
export async function deleteProof(path){
  const {url,key}=serviceConfig();
  await fetch(url+'/storage/v1/object/payment-proofs/'+path,{
    method:'DELETE',headers:adminHeaders(key),signal:AbortSignal.timeout(9000)
  }).catch(()=>{});
}
export async function signedProof(path){
  const {url,key}=serviceConfig();
  const res=await fetch(url+'/storage/v1/object/sign/payment-proofs/'+path,{
    method:'POST',
    headers:adminHeaders(key,{'Content-Type':'application/json'}),
    body:JSON.stringify({expiresIn:180}),signal:AbortSignal.timeout(10000)
  });
  if(!res.ok)return null;
  const data=await res.json();
  const signed=data.signedURL||data.signedUrl||'';
  if(!signed.startsWith('/object/sign/'))return null;
  return url+'/storage/v1'+signed;
}
