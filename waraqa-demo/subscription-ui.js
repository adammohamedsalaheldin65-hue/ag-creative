/* Waraqa monthly subscriptions: gated by server config, NOT a client-side trial counter.
   Existing guest-first demo remains unchanged until SUBSCRIPTION_ENABLED=true on Vercel.
   Every protected request and the database RLS also enforce expiry server-side. */
'use strict';

const legacySubscriptionInit=initializeProduction;
const legacySubscriptionRender=render;
const legacySubscriptionLogin=loginHTML;
const legacySubscriptionAct=act;
const legacySubscriptionSignout=signOutTeacher;
const legacySubscriptionSettings=settingsHTML;
const legacySubscriptionHeader=head;
const legacySubscriptionLoginAction=loginOrRegister;
let subscriptionBusy=false;
let proofData='';
let subscriptionError='';
let subscriptionChecking=false;
let renewalOpen=false;
let selectedSubscriptionPlan='basic';

const isSubscriptionMode=()=>serviceConfig?.subscriptionEnabled===true;
function localSubscriptionActive(){
 const x=state.subscriptionStatus;
 return !!x?.access&&Date.parse(x.accessEndsAt||'')>Date.now();
}
const localDate=iso=>iso?new Date(iso).toLocaleDateString('ar-EG',{year:'numeric',month:'long',day:'numeric'}):'غير متاح';
function subscriptionNotice(){
 const st=state.subscriptionStatus||{};
 const active=localSubscriptionActive();
 const remaining=active?Math.max(0,Math.ceil((Date.parse(st.accessEndsAt)-Date.now())/86400000)):0;
 const planLabel=st.plan==='premium'?'المتقدمة':st.plan==='basic'?'الأساسية':'التجربة المجانية';
 return '<div class="subscription-tag">'+(active?('🟢 '+planLabel+' • '+remaining+' يوم متبقٍ • حتى '+E(localDate(st.accessEndsAt))):'🔴 الاشتراك منتهي')+'</div>';
}

function subscriptionLoginMarkup(){
 const signup=state.authView==='signup';
 return '<div class="login-page"><div class="login-visual">'+logo()+
 '<div><h1>شهر كامل هدية<br>لكل معلم جديد ✨</h1><p>حوّل درسك لامتحان ذكي، وراجع واطبع امتحاناتك من حسابك.</p><div class="big-illustration">📚✍️</div></div><div class="bottom-note">ورقة — مساحة المعلم الذكية</div></div>'+
 '<div class="login-form-wrap"><form class="login-form" id="login-form">'+logo()+
 '<h2>'+(signup?'أنشئ حسابك وابدأ الشهر المجاني':'أهلًا برجوعك لورقة 👋')+'</h2>'+
 '<p>'+(signup?'فترة التجربة شهر تقويمي من لحظة إنشاء حسابك، يحسبها الخادم تلقائيًا.': 'سجّل دخولك للوصول إلى امتحاناتك أو تجديد الاشتراك.')+'</p>'+
 (state.authError?'<div class="notice">'+E(state.authError)+'</div>':'')+
 (signup?'<div class="form-field"><label for="login-name">اسم المعلم</label><input id="login-name" class="field" required minlength="2" maxlength="70" autocomplete="name" placeholder="أ/ زينب المحمدي"/></div>':'')+
 '<div class="form-field spaced"><label for="login-email">البريد الإلكتروني</label><input id="login-email" class="field" type="email" required autocomplete="email" placeholder="teacher@example.com"/></div>'+
 '<div class="form-field spaced"><label for="login-password">كلمة المرور</label><input id="login-password" class="field" type="password" required minlength="8" autocomplete="'+(signup?'new-password':'current-password')+'" placeholder="8 أحرف أو أكثر"/></div>'+
 '<button class="btn btn-primary spaced" type="submit" style="width:100%">'+(signup?'إنشاء حساب وبدء الشهر مجانًا':'تسجيل الدخول')+' ←</button>'+
 '<div class="toolbar spaced" style="justify-content:space-between"><button type="button" class="text-action" data-action="auth-mode" data-mode="'+(signup?'login':'signup')+'">'+(signup?'لديك حساب بالفعل':'مستخدم جديد؟ ابدأ مجانًا')+'</button>'+
 (signup?'':'<button type="button" class="text-action" data-action="reset-password">نسيت كلمة المرور؟</button>')+'</div>'+ '<p class="mini-note spaced">طالب؟ <a href="/student.html" style="color:#6557e9;font-weight:800">ادخل بوابة الطلاب من هنا ↗</a></p>'
 '<p class="mini-note spaced">بعد نهاية الفترة المجانية، يتطلب استخدام المنصة اشتراكًا شهريًا. لا يُحتسب الشهر من تاريخ أول زيارة فقط بل من تاريخ إنشاء الحساب المسجّل في قاعدة البيانات.</p>'+
 '</form></div></div>';
}
function paymentHistoryHTML(){
 const payments=state.subscriptionStatus?.payments||[];
 if(!payments.length)return '';
 const labels={pending:'⏳ قيد مراجعة التحويل',rejected:'❌ مرفوض — يمكنك إرسال إيصال صحيح',approved:'✅ تم تأكيد التحويل وتفعيل الشهر'};
 return '<div class="form-card spaced"><h3>آخر طلبات الدفع</h3>'+payments.slice(0,3).map(p=>
 '<p style="padding:6px 0;margin:0;border-bottom:1px solid #e9eef3">'+(labels[p.status]||E(p.status))+
 ' · '+E(localDate(p.created_at))+(p.admin_note?'<small class="muted" style="display:block">'+E(p.admin_note)+'</small>':'')+'</p>').join('')+'</div>';
}
function subscriptionPaywall(){
 const st=state.subscriptionStatus||{};
 const pending=st.payments?.some(p=>p.status==='pending');
 const isSetupMissing=!st.trialEndsAt&&!subscriptionError;
 const hasPrice=!!st.paymentReady;
 const plans=st.plans||{};
 const selected=plans[selectedSubscriptionPlan]||plans.basic||{name:'الأساسية',priceEGP:st.priceEGP||50};
 const price=selected.priceEGP;
 const isPremiumLocked=st.plan==='premium'&&Date.parse(st.paidUntil)>Date.now();
 const destination=st.destination||'';
 const accountName=st.accountName||'';
 return '<div class="subscription-page"><section class="subscription-card">'+logo()+
 '<h1>'+(subscriptionError?'مشكلة مؤقتة في حسابك':isSetupMissing?'حسابك بحاجة لإعداد الاشتراك':renewalOpen&&localSubscriptionActive()?'تجديد الاشتراك مبكرًا':'انتهت الفترة المجانية أو اشتراكك')+'</h1>'+
 '<p class="subheading">مرحبًا '+E(state.user?.name||'يا معلم')+'. '+(subscriptionError?E(subscriptionError):isSetupMissing?'الاشتراكات لم تُجهز على قاعدة البيانات بعد. تواصل مع الإدارة.':'امتحاناتك محفوظة، وستعود إليها بعد تأكيد الاشتراك.')+'</p>'+
 (st.trialEndsAt?'<div class="subscription-line">🎁 بداية التجربة: <b>'+E(localDate(st.trialStartedAt))+'</b></div><div class="subscription-line">🗓️ نهاية التجربة المجانية: <b>'+E(localDate(st.trialEndsAt))+'</b></div>':'')+
 (st.paidUntil?'<div class="subscription-line">✅ اشتراك مدفوع حتى: <b>'+E(localDate(st.paidUntil))+'</b></div>':'')+
 (hasPrice?'<div class="subscription-plans">'+
  ['basic','premium'].map(id=>{
   const p=plans[id]||{},picked=selectedSubscriptionPlan===id,locked=isPremiumLocked&&id==='basic';
   return '<button type="button" class="subscription-plan '+(picked?'chosen':'')+'" data-action="choose-plan" data-plan="'+id+'" '+(locked?'disabled title="لا يمكن تحويل باقة متقدمة نشطة إلى أساسية قبل انتهاء مدتها"':'')+'>'+
   '<b>'+(id==='basic'?'📘 الأساسية':'✨ المتقدمة')+'</b>'+
   '<strong>'+E(p.priceEGP??(id==='premium'?200:50))+' جنيه/شهر</strong>'+
   '<small>'+(id==='basic'?'3 عمليات ذكاء اصطناعي يوميًا':'بدون حد يومي لحساب المعلم • حماية من الطلبات الكثيفة')+'</small>'+
   (picked?'<span class="subscription-choice">✓ الباقة المختارة</span>':'')+'</button>';
  }).join('')+'</div>'+
 '<div class="subscription-price">'+E(price)+' جنيه <small> / شهر — '+E(selected.name||'الباقة المختارة')+'</small></div>'+
 '<p class="mini-note">اسم المستفيد: <strong>'+E(accountName)+'</strong></p>'+
 '<p class="mini-note">حوّل المبلغ الموضح إلى إنستا باي:</p><div class="subscription-destination" dir="ltr">'+E(destination)+'</div>'+
 '<a class="btn btn-primary spaced" style="display:inline-flex;text-decoration:none;justify-content:center;width:100%" href="'+E(destination)+'" target="_blank" rel="noopener noreferrer">📲 افتح إنستا باي لتحويل '+E(price)+' جنيه</a>'+
 '<p class="mini-note spaced">اتأكد إن اسم المستفيد نهاد، والمبلغ مطابق للباقة المختارة قبل التحويل، واحتفظ بصورة نجاح العملية.</p>':
 '<div class="notice">إعدادات أسعار الباقات أو رابط إنستا باي غير مكتملة بعد، لذلك استقبال التحويلات متوقف مؤقتًا.</div>')+
 (pending?'<div class="notice blue spaced">⏳ وصل إيصالك وهو الآن قيد المراجعة. فحص الصورة بالذكاء الاصطناعي لا يعني وصول المال؛ سيتم تفعيل الشهر بعد مطابقة التحويل الحقيقي.</div>':
   hasPrice&&!isSetupMissing&&!subscriptionError?'<form id="payment-form" class="spaced">'+
   '<div class="form-field"><label for="payment-file">ارفع صورة نجاح تحويل إنستا باي</label><input id="payment-file" class="field" type="file" accept="image/png,image/jpeg,image/webp" required/><p class="hint">PNG أو JPG أو WEBP، حتى 1.95 ميجابايت بعد التجهيز.</p></div>'+
   '<div class="form-field spaced"><label for="payment-note">رقم العملية أو مرجع التحويل (اختياري)</label><input id="payment-note" class="field" maxlength="160" placeholder="اكتب رقم العملية الظاهر في الإيصال"/></div>'+
   '<label class="subscription-consent spaced"><input id="payment-consent" type="checkbox" required/> أوافق على إرسال صورة الإيصال لخادم ورقة وخدمة Gemini لفحصها مبدئيًا، وأفهم أن التفعيل يتطلب تأكيد التحويل من الإدارة.</label>'+
   '<button type="submit" class="btn btn-primary spaced" style="width:100%">📤 إرسال إيصال '+E(price)+' جنيه للمراجعة</button></form>':'')+
 paymentHistoryHTML()+
 '<div class="toolbar spaced" style="justify-content:space-between"><button class="btn btn-outline" data-action="refresh-subscription">↻ تحديث حالة الاشتراك</button>'+
 (renewalOpen&&localSubscriptionActive()?'<button class="btn btn-outline" data-action="close-renewal">← العودة لحسابي</button>':'')+
 '<button class="btn btn-outline" data-action="logout">تسجيل الخروج</button></div>'+
 '<p class="mini-note spaced">التحويل يتم خارج ورقة في تطبيق إنستا باي. لا تشارك كلمة مرورك أو الرقم السري أو رمز OTP؛ نحتاج فقط صورة الإيصال.</p>'+
 '</section></div>';
}
function subscriptionLoadingMarkup(){
 return '<div class="subscription-page"><div class="subscription-card">'+logo()+'<h2>جارٍ التحقق من صلاحية اشتراكك...</h2><p class="hint">يتم التحقق من قاعدة البيانات لضمان صحة تاريخ انتهاء المدة.</p>'+
 '<button class="btn btn-outline spaced" data-action="refresh-subscription">إعادة المحاولة</button>'+
 '<button class="btn btn-outline spaced" data-action="logout">تسجيل خروج</button></div></div>';
}

loginHTML=function(){
 if(isSubscriptionMode())return subscriptionLoginMarkup();
 return legacySubscriptionLogin();
};
render=function(){
 if(!isSubscriptionMode())return legacySubscriptionRender();
 if(!state.user){document.querySelector('#app').innerHTML=loginHTML();return}
 if(subscriptionChecking&&!state.subscriptionStatus){
  document.querySelector('#app').innerHTML=subscriptionLoadingMarkup();return;
 }
 if(!localSubscriptionActive()||renewalOpen){
  document.querySelector('#app').innerHTML=subscriptionPaywall();return;
 }
 state.authRequested=false;
 legacySubscriptionRender();
};
head=function(title){
 let html=legacySubscriptionHeader(title);
 if(isSubscriptionMode()&&state.user&&localSubscriptionActive()){
  html=html.replace('</header>','<button class="btn btn-outline btn-sm" data-action="open-renewal" title="اشتراكي">'+subscriptionNotice()+'</button></header>');
 }
 return html;
};
settingsHTML=function(){
 const body=legacySubscriptionSettings();
 if(!isSubscriptionMode())return body;
 return body.replace('</div></div>', '</div></div>')+
 '<div class="form-card spaced" style="max-width:640px"><h3>💳 اشتراكي</h3>'+
 subscriptionNotice()+
 '<p class="mini-note">تاريخ انتهاء اشتراكك محسوب من وقت التسجيل أو تجديد الشهر، وليس من ساعة جهازك.</p>'+
 '<button class="btn btn-outline" data-action="open-renewal">تجديد الاشتراك / رفع إيصال</button></div>';
};

async function subscriptionRefresh(){
 if(!isSubscriptionMode()||!supabaseClient||!state.user)return;
 subscriptionChecking=true;subscriptionError='';
 try{
  const {data,error}=await supabaseClient.auth.getSession();
  if(error||!data.session?.access_token)throw new Error('جلسة الدخول انتهت؛ سجل دخولك مرة أخرى');
  const resp=await fetch('/api/subscription-status',{
   headers:{Authorization:'Bearer '+data.session.access_token},cache:'no-store'
  });
  const json=await resp.json().catch(()=>({}));
  if(!resp.ok)throw new Error(json.error||'تعذّر قراءة الاشتراك');
  state.subscriptionStatus=json;
  if(json.plan==='premium'&&Date.parse(json.paidUntil)>Date.now())selectedSubscriptionPlan='premium';
 }catch(error){
  subscriptionError=error.message||'تعذر التحقق من الاشتراك';
  state.subscriptionStatus=null; // Fail closed; no temporary or local trial bypass.
 }finally{subscriptionChecking=false}
}
async function waraqaEnsureTeacherRole(userId){
 if(!serviceConfig?.studentPortalEnabled)return;
 const {data,error}=await supabaseClient.from('waraqa_accounts').select('role').eq('user_id',userId).single();
 if(error||!data?.role)throw new Error('تعذر التحقق من نوع الحساب. راجع إعداد بوابة الطلاب.');
 if(data.role==='student'){
   await supabaseClient.auth.signOut();
   throw new Error('حسابك طالب، افتح بوابة الطلاب من الرابط الموجود أسفل تسجيل الدخول.');
 }
 if(data.role!=='teacher')throw new Error('نوع الحساب غير معروف.');
}
async function subscriptionLoginSubmit(e){
 e?.preventDefault?.();
 if(!supabaseClient)return toast('الخادم غير متصل. حاول مرة أخرى.');
 const signup=state.authView==='signup';
 const email=($('#login-email')?.value||'').trim().toLowerCase();
 const password=$('#login-password')?.value||'';
 const name=($('#login-name')?.value||'').trim();
 if(!email||password.length<8||(signup&&name.length<2))return toast('أكمل البريد وكلمة المرور (8 أحرف) واسم المعلم');
 busy(true,signup?'جارٍ إنشاء حسابك والشهر المجاني...':'جارٍ تسجيل الدخول...');
 try{
  const response=signup
    ?await supabaseClient.auth.signUp({email,password,options:{data:{full_name:name,waraqa_role:'teacher'}}})
    :await supabaseClient.auth.signInWithPassword({email,password});
  if(response.error)throw response.error;
  if(signup&&!response.data?.session){
   state.authView='login';
   state.authError='تم إرسال بريد لتأكيد الحساب. افتح الرسالة، ثم سجل دخولك. الشهر يبدأ من تاريخ إنشاء الحساب.';
   render();return;
  }
  const user=response.data?.user;
  if(!user||user.is_anonymous)throw new Error('استخدم حساب بريد إلكتروني حقيقي');
  await waraqaEnsureTeacherRole(user.id);
  state.user=userFromAuth(user);
  state.draft.teacher=state.user.name;
  state.authRequested=false;state.authError='';
  state.exam=null;state.records=[];state.page='dashboard';
  await subscriptionRefresh();
  if(localSubscriptionActive())await refreshTeacherRecords();
  render();
 }catch(error){
  state.authError=error.message||'تعذّر تسجيل الدخول';
  render();
 }finally{busy(false)}
}
loginOrRegister=async function(e){
 if(isSubscriptionMode())return subscriptionLoginSubmit(e);
 return legacySubscriptionLoginAction(e);
};
signOutTeacher=async function(){
 if(!isSubscriptionMode())return legacySubscriptionSignout();
 try{stopScenes();await supabaseClient?.auth.signOut()}catch{}
 state.user=null;state.records=[];state.exam=null;state.subscriptionStatus=null;
 state.authRequested=true;state.authView='login';state.authError='';state.aiAvailable=false;
 state.draft=makeDraft();renewalOpen=false;subscriptionError='';proofData='';selectedSubscriptionPlan='basic';
 render();
};
async function uploadPayment(){
 if(subscriptionBusy)return;
 if(!proofData)return toast('اختار صورة إيصال التحويل الأول');
 if(!$('#payment-consent')?.checked)return toast('وافق على إرسال الإيصال للفحص');
 const note=($('#payment-note')?.value||'').trim();
 subscriptionBusy=true;busy(true,'جارٍ فحص الإيصال وحفظ طلب التجديد...');
 try{
  const response=await fetch('/api/payment-proof',{
   method:'POST',headers:await aiHeaders(),
   body:JSON.stringify({image:proofData,referenceNote:note,plan:selectedSubscriptionPlan})
  });
  const json=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(json.error||'تعذّر إرسال الإيصال');
  proofData='';await subscriptionRefresh();render();
  toast('✅ وصل الإيصال، وفي انتظار تأكيد التحويل الحقيقي من الإدارة');
 }catch(error){toast('⚠️ '+error.message)}
 finally{subscriptionBusy=false;busy(false)}
}
async function readPaymentFile(file){
 if(!file)return;
 if(!/^image\/(png|jpeg|webp)$/.test(file.type))return toast('استخدم JPG أو PNG أو WEBP فقط');
 if(file.size>9_000_000)return toast('الصورة الأصلية كبيرة جدًا');
 try{
  const data=await readPhoto(file); // compressed JPEG, 1250px maximum
  if(data.data.length>2_600_000)throw new Error('صورة الإيصال كبيرة، قلل حجمها');
  proofData=data.data;
  toast('✅ تم تجهيز صورة الإيصال');
 }catch(e){proofData='';toast(e.message)}
}
act=async function(action,button){
 if(!isSubscriptionMode())return legacySubscriptionAct(action,button);
 if(action==='auth-mode'){state.authView=button.dataset.mode==='signup'?'signup':'login';state.authError='';render();return}
 if(action==='reset-password')return requestPasswordReset();
 if(action==='choose-plan'){
  const desired=button.dataset.plan;
  if(!['basic','premium'].includes(desired))return;
  if(state.subscriptionStatus?.plan==='premium'&&Date.parse(state.subscriptionStatus.paidUntil)>Date.now()&&desired==='basic'){
   toast('لا يمكن تخفيض باقة متقدمة نشطة قبل نهاية مدتها');return;
  }
  selectedSubscriptionPlan=desired;
  proofData='';
  render();return;
 }
 if(action==='logout')return signOutTeacher();
 if(action==='refresh-subscription'){await subscriptionRefresh();render();return}
 if(action==='open-renewal'){
  if(!state.user)return;
  await subscriptionRefresh();renewalOpen=true;render();return;
 }
 if(action==='close-renewal'){renewalOpen=false;render();return}
 if(!state.user){render();return}
 if(!localSubscriptionActive()){render();toast('اشتراكك منتهي، جدد اشتراكك أولًا');return}
 if(renewalOpen){render();return}
 return legacySubscriptionAct(action,button);
};

initializeProduction=async function(){
 state.user=null;state.authRequested=true;state.authView='login';
 state.aiAvailable=false;state.subscriptionStatus=null;
 render();
 let config;
 try{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),7000);
  const response=await fetch('/api/config',{signal:controller.signal,cache:'no-store'});
  clearTimeout(timer);
  if(!response.ok)throw new Error('خطأ إعدادات الخادم');
  config=await response.json();
 }catch{
  // Static previews continue to function; hosted production fails closed if config is not available.
  if(!['localhost','127.0.0.1','htmlpreview.github.io'].includes(location.hostname)){
   serviceConfig={subscriptionEnabled:true};
   state.authError='تعذر الاتصال بخادم ورقة، حاول تحديث الصفحة لاحقًا.';
   render();return;
  }
  return legacySubscriptionInit();
 }
 if(!config.subscriptionEnabled)return legacySubscriptionInit();
 serviceConfig=config;
 cloudMode=!!(config.authConfigured&&config.supabaseUrl&&config.supabaseKey);
 state.aiAvailable=!!config.aiConfigured;
 if(!cloudMode||!window.supabase?.createClient){
  state.authError='حسابات المعلمين غير متصلة. راجع إعدادات قاعدة البيانات.';
  render();return;
 }
 try{
  supabaseClient=window.supabase.createClient(config.supabaseUrl,config.supabaseKey,{
   auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  const {data,error}=await supabaseClient.auth.getUser();
  const user=error?null:data?.user;
  if(user?.is_anonymous){
   await supabaseClient.auth.signOut(); // Guests cannot start trials.
  }else if(user){
   try{await waraqaEnsureTeacherRole(user.id)}catch(error){
     state.authError=error.message;
     await supabaseClient.auth.signOut().catch(()=>{});
     state.user=null;state.authRequested=true;
     render();return;
   }
   state.user=userFromAuth(user);
   state.draft.teacher=state.user.name;
   state.authRequested=false;
   await subscriptionRefresh();
   if(localSubscriptionActive())await refreshTeacherRecords();
  }
  supabaseClient.auth.onAuthStateChange(event=>{
   if(event==='SIGNED_OUT'){
    state.user=null;state.records=[];state.exam=null;
    state.subscriptionStatus=null;state.authView='login';
    state.authRequested=true;renewalOpen=false;render();
   }
  });
 }catch(error){state.authError='تعذر استعادة تسجيل الدخول: '+error.message}
 render();
};
document.addEventListener('submit',e=>{
 if(e.target?.id!=='payment-form'||!isSubscriptionMode())return;
 e.preventDefault();if(!state.user)return;
 if(localSubscriptionActive()&&!renewalOpen)return;
 uploadPayment();
});
document.addEventListener('change',e=>{
 if(e.target?.id==='payment-file'&&isSubscriptionMode()){
  proofData='';readPaymentFile(e.target.files?.[0]);
 }
});
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='visible'&&isSubscriptionMode()&&state.user){
  subscriptionRefresh().then(()=>render());
 }
});
// Local countdown is cosmetic. Expired cloud access is always independently blocked in RLS and APIs.
setInterval(()=>{
 if(isSubscriptionMode()&&state.user&&!localSubscriptionActive()&&!renewalOpen)render();
},60000);
