// Server-side Supabase REST helpers. Never import into browser code.
export const PAYMENT_PLANS=Object.freeze({
  basic:{id:'basic',name:'الباقة الأساسية',priceEGP:50,unlimitedDailyAI:false},
  premium:{id:'premium',name:'الباقة المتقدمة',priceEGP:200,unlimitedDailyAI:true}
});
const DEFAULT_INSTAPAY_LINK='https://ipn.eg/S/nehadsedemy/instapay/53H17I';
export function billingSettings(){
  // These are public payment details supplied by the shop owner.
  // The frontend NEVER sets its own payable amount.
  const accountName=String(process.env.INSTAPAY_ACCOUNT_NAME||'نهاد').trim().slice(0,140);
  const destination=String(process.env.INSTAPAY_DESTINATION||DEFAULT_INSTAPAY_LINK).trim().slice(0,220);
  const validDestination=/^https:\/\/ipn\.eg\/S\/[a-zA-Z0-9_-]+\/instapay\/[a-zA-Z0-9_-]+\/?$/.test(destination);
  const basicPrice=Number(process.env.SUBSCRIPTION_PRICE_EGP||50);
  const premiumPrice=Number(process.env.PREMIUM_PRICE_EGP||200);
  const isValid=n=>Number.isSafeInteger(n)&&n>0&&n<=100000;
  const plans={
    basic:{...PAYMENT_PLANS.basic,priceEGP:isValid(basicPrice)?basicPrice:null},
    premium:{...PAYMENT_PLANS.premium,priceEGP:isValid(premiumPrice)?premiumPrice:null}
  };
  return {
    enabled:process.env.SUBSCRIPTION_ENABLED==='true',
    price:plans.basic.priceEGP,
    destination:validDestination?destination:'',
    accountName,
    plans,
    paymentReady:!!(validDestination&&accountName&&isValid(basicPrice)&&isValid(premiumPrice))
  };
}
export function selectedPlan(settings,requestedPlan){
 const id=String(requestedPlan||'');
 const plan=settings?.plans?.[id];
 if(!plan||!Number.isSafeInteger(plan.priceEGP)||plan.priceEGP<1)
  throw Object.assign(new Error('اختر باقة اشتراك صحيحة'),{status:400});
 return plan;
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
  const rows=await supabaseRest('teacher_subscriptions?select=trial_started_at,trial_ends_at,paid_until,plan&user_id=eq.'+encodeURIComponent(userId)+'&limit=1');
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
