function secrets(){
 const url=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
 const publicKey=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||'';
 const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
 if(!url||!/^https:\/\/[a-z0-9.-]+\.supabase\.co$/i.test(url)||!publicKey||!serviceKey){
  throw Object.assign(new Error('حسابات المعلمين غير مفعلة بالكامل بعد.'),{status:503});
 }
 return {url,publicKey,serviceKey};
}
export async function authenticate(request){
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
 if(anonymous && process.env.ALLOW_ANONYMOUS_AI!=='true')
   throw Object.assign(new Error('الذكاء الاصطناعي للضيوف غير مفعّل على الخادم بعد.'),{status:403});
 return {user,serviceKey,url,isAnonymous:anonymous};
}
export async function claimQuota(auth,kind){
 const res=await fetch(auth.url+'/rest/v1/rpc/claim_ai_quota',{
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
  const why=info?.reason==='global'?'اكتملت حصة المنصة المجانية اليوم. جرّب غدًا.':'وصلت للحد المجاني لليوم. حاول غدًا.';
  throw Object.assign(new Error(why),{status:429});
 }
 return info;
}
