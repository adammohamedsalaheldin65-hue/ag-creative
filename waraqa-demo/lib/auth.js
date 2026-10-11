import {getSubscription,subscriptionAccess} from './billing.js';

function secrets(){
 const url=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
 const publicKey=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||'';
 const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
 if(!url||!/^https:\/\/[a-z0-9.-]+\.supabase\.co$/i.test(url)||!publicKey||!serviceKey){
  throw Object.assign(new Error('حسابات المعلمين غير مفعلة بالكامل بعد.'),{status:503});
 }
 return {url,publicKey,serviceKey};
}
export function studentPortalEnabled(){
 return process.env.STUDENT_PORTAL_ENABLED==='true' && process.env.SUBSCRIPTION_ENABLED==='true';
}
async function userAccountRole(url,serviceKey,userId){
 const response=await fetch(
   url+'/rest/v1/waraqa_accounts?select=role&user_id=eq.'+encodeURIComponent(userId)+'&limit=1',
   {headers:{
     apikey:serviceKey,
     ...(serviceKey.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+serviceKey}),
     Accept:'application/json'
   },signal:AbortSignal.timeout(9000)}
 );
 if(!response.ok)throw Object.assign(new Error('بوابة الحسابات تحتاج تنفيذ تحديث قاعدة البيانات.'),{status:503});
 const rows=await response.json();
 const role=rows?.[0]?.role;
 if(!['student','teacher'].includes(role))
   throw Object.assign(new Error('نوع الحساب غير معروف. تواصل مع إدارة ورقة.'),{status:403});
 return role;
}
export async function authenticate(request,{requireAccess=true,role='teacher'}={}){
 const {url,publicKey,serviceKey}=secrets();
 const bearer=String(request.headers.get('authorization')||'');
 if(!/^Bearer [A-Za-z0-9._~+/-]+=*$/.test(bearer))throw Object.assign(new Error('سجل دخولك أولًا'),{status:401});
 let res;
 try{res=await fetch(url+'/auth/v1/user',{headers:{apikey:publicKey,Authorization:bearer},signal:AbortSignal.timeout(9000)});}
 catch{throw Object.assign(new Error('تعذر التحقق من حساب المعلم'),{status:503})}
 if(!res.ok)throw Object.assign(new Error('انتهت الجلسة، سجل الدخول مرة أخرى'),{status:401});
 const user=await res.json();
 if(!user?.id)throw Object.assign(new Error('تعذر التحقق من الجلسة'),{status:401});
 const anonymous=user.is_anonymous===true;
 let accountRole='teacher';
 if(studentPortalEnabled()){
   if(anonymous)throw Object.assign(new Error('سجل بحساب بريد إلكتروني أولًا'),{status:401});
   accountRole=await userAccountRole(url,serviceKey,user.id);
   if(role!=='any'&&accountRole!==role)
     throw Object.assign(new Error(role==='teacher'?'هذا حساب طالب. افتح بوابة الطلاب.':'هذا حساب معلم. استخدم بوابة المعلمين.'),{status:403});
 }else if(role==='student'){
   throw Object.assign(new Error('بوابة الطلاب لم تُفعّل بعد. يلزم تحديث قاعدة البيانات ثم إعداد Vercel.'),{status:503});
 }
 if(process.env.SUBSCRIPTION_ENABLED==='true' && role!=='student'){
   if(anonymous)throw Object.assign(new Error('أنشئ حساب معلم ببريد إلكتروني للاستفادة من الشهر المجاني'),{status:401});
   if(requireAccess){
     const subscription=await getSubscription(user.id);
     if(!subscriptionAccess(subscription))
       throw Object.assign(new Error('انتهى اشتراكك. ارفع إيصال التحويل وانتظر تأكيد الدفع لتجديد الشهر.'),{status:402});
   }
 }
 if(anonymous && process.env.ALLOW_ANONYMOUS_AI!=='true')
   throw Object.assign(new Error('الذكاء الاصطناعي للضيوف غير مفعّل على الخادم بعد.'),{status:403});
 return {user,serviceKey,url,isAnonymous:anonymous,role:accountRole};
}
export async function claimQuota(auth,kind){
 const quotaRpc=process.env.SUBSCRIPTION_ENABLED==='true'?'claim_subscription_ai_quota':'claim_ai_quota';
 const res=await fetch(auth.url+'/rest/v1/rpc/'+quotaRpc,{
  method:'POST',
  headers:{
   apikey:auth.serviceKey,
   ...(auth.serviceKey.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+auth.serviceKey}),
   'Content-Type':'application/json',
   Accept:'application/json'
  },
  body:JSON.stringify({p_user:auth.user.id,p_kind:kind}),
  signal:AbortSignal.timeout(10000)
 });
 if(!res.ok)throw Object.assign(new Error('تعذر فحص الحصة اليومية، حاول لاحقًا'),{status:503});
 const data=await res.json();
 const info=Array.isArray(data)?data[0]:data;
 if(info?.allowed!==true){
  const why={
    daily:'اكتملت حصتك اليومية في الباقة الأساسية. الباقة المتقدمة ليس لها حد يومي على مستوى الحساب.',
    burst:'طلبات كثيرة في دقيقة واحدة؛ انتظر دقيقة قبل المحاولة مرة أخرى.',
    global_burst:'يوجد ضغط مؤقت على الذكاء الاصطناعي؛ حاول بعد دقيقة.',
    expired:'انتهى اشتراكك الشهري، جدد الاشتراك.',
    global:'اكتملت حصة المنصة القديمة مؤقتًا. حاول لاحقًا.'
  }[info?.reason]||'تعذر حجز طلب التوليد الآن؛ حاول لاحقًا.';
  throw Object.assign(new Error(why),{status:429});
 }
 return info;
}

export async function claimStudentQuota(auth){
 if(!studentPortalEnabled()||auth.role!=='student')
   throw Object.assign(new Error('التلخيص الطلابي غير متاح لهذا الحساب'),{status:403});
 const response=await fetch(auth.url+'/rest/v1/rpc/claim_student_ai_quota',{
  method:'POST',
  headers:{
   apikey:auth.serviceKey,
   ...(auth.serviceKey.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+auth.serviceKey}),
   'Content-Type':'application/json',
   Accept:'application/json'
  },
  body:JSON.stringify({p_user:auth.user.id}),
  signal:AbortSignal.timeout(9000)
 });
 if(!response.ok)throw Object.assign(new Error('تعذر التحقق من حد الاستخدام. تأكد من تنفيذ SQL الخاص ببوابة الطلاب.'),{status:503});
 const payload=await response.json();
 const info=Array.isArray(payload)?payload[0]:payload;
 if(info?.allowed!==true){
  const messages={
   daily:'خلصت محاولتي الذكاء الاصطناعي المجانيتين لليوم. ارجع بكرة.',
   global:'اكتملت الحصة اليومية المخصصة لطلاب ورقة لحماية تكاليف المنصة. جرب غدًا.',
   burst:'انتظر دقيقة قبل إرسال طلب جديد.',
   role:'هذا الحساب غير مسجّل كطالب.'
  };
  throw Object.assign(new Error(messages[info?.reason]||'الطلب غير متاح حاليًا'),{status:429});
 }
 return info;
}
