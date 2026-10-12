/* Student portal isolated from Waraqa teacher subscription/editor state.
   All student AI jobs, assessment access and grades are validated on server.
   There are no Gemini/service-role secrets or answer keys embedded in this client. */
'use strict';
const st={
 config:null,client:null,user:null,account:null,mode:'login',view:'study',
 busy:false,notice:'',grade:'',subject:'',lesson:'',study:null,studyReview:null,
 code:new URLSearchParams(location.search).get('code')||'',quiz:null,attempt:null,
 results:null, pdfLoading:false
};
const studentEl=id=>document.getElementById(id);
const studentEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const studentDate=value=>value?new Date(value).toLocaleDateString('ar-EG'):'';
const studentSignedIn=()=>!!st.user&&st.account?.role==='student';
function studentAlert(text){
 st.notice=String(text||'');
 const element=studentEl('waraqa-alert');
 if(element)element.innerHTML=st.notice?'<div class="notice">'+studentEscape(st.notice)+'</div>':'';
}
function studentRender(){
 const main=studentEl('student-app'),nav=studentEl('student-nav-user');
 if(!main)return;
 if(!st.config?.studentPortalEnabled){
  main.innerHTML='<div class="card" style="max-width:700px;margin:45px auto"><h2>📚 بوابة الطلاب قيد التفعيل</h2>'+
   '<p>التصميم جاهز. إدارة ورقة تحتاج تشغيل تحديث قاعدة البيانات ثم تفعيل بوابة الطلاب في Vercel. لا يوجد دفع مطلوب من الطالب.</p>'+
   '<a href="/">العودة لبوابة المعلمين ←</a></div>';
  nav.textContent='';return;
 }
 if(!st.client){
  main.innerHTML='<div class="card"><h2>تعذر تجهيز تسجيل الدخول</h2><p>تأكد من إعداد Supabase واتصال الإنترنت.</p></div>';
  return;
 }
 if(!st.user){nav.textContent='';main.innerHTML=studentLoginHTML();return;}
 if(st.account?.role==='teacher'){
  nav.innerHTML='<button type="button" class="btn outline" data-action="student-logout">تسجيل الخروج</button>';
  main.innerHTML='<div class="card"><h2>👩‍🏫 ده حساب معلم</h2>'+
   '<p>حساب المعلم منفصل عن حساب الطالب. افتح بوابة المعلمين للوصول لاشتراكك وامتحاناتك.</p>'+
   '<a href="/">فتح بوابة المعلمين ←</a></div>';
  return;
 }
 if(!studentSignedIn()){
  main.innerHTML='<div class="card">جارٍ التحقق من نوع الحساب...</div>';return;
 }
 nav.innerHTML='<span>أهلًا، '+studentEscape(st.account.name)+'</span>'+
  '<button class="btn outline" type="button" data-action="student-logout" style="padding:7px 11px">خروج</button>';
 main.innerHTML='<div class="layout"><nav aria-label="أقسام بوابة الطالب">'+
  studentNavButton('study','📚','مذاكرتي')+
  studentNavButton('tutor','📸','اتعلّم بالتصوير')+
  studentNavButton('quiz','✏️','حل امتحان')+
  studentNavButton('results','📈','نتائجي')+
  '<p class="nav-note">ذكاء اصطناعي: محاولتان لكل طالب يوميًا، و25 طلبًا إجماليًا للطلاب لحماية تكاليف ورقة.</p>'+
  '</nav><div class="work">'+
  '<section class="hero"><h1>أهلًا، '+studentEscape(st.account.name)+'! 👋</h1>'+
  '<p>ذاكر درسك، جرّب نفسك، وحل امتحانات معلمك وشوف درجاتك.</p></section>'+
  (st.view==='study'?studentStudyHTML():st.view==='tutor'?tutorViewHTML():st.view==='quiz'?studentQuizHTML():studentResultsHTML())+
  '</div></div>';
}
function studentNavButton(view,emoji,title){
 return '<button type="button" data-action="student-tab" data-view="'+view+'" class="'+(st.view===view?'active':'')+'">'+emoji+' '+title+'</button>';
}
function studentLoginHTML(){
 const signup=st.mode==='signup';
 return '<div class="auth-wrap"><section class="auth-art"><h1>ذاكر بطريقتك مع ورقة ✨</h1>'+
  '<p>افهم الدرس، حل أسئلة تدريب، وشارك في امتحانات معلمك من موبايلك. بوابة الطالب مجانية بحدود الاستخدام المتاحة.</p>'+
  '<div style="font-size:70px">📚✏️</div></section><section class="auth-pane">'+
  '<h2>'+(signup?'إنشاء حساب طالب':'مرحبًا بيك!')+'</h2>'+
  '<p class="helper">حساب الطالب منفصل عن حساب المعلم. لو معاك كود امتحان، هتلاقيه بعد تسجيل الدخول.</p>'+
  '<div class="auth-tabs"><button type="button" data-action="student-auth-mode" data-mode="login" class="'+(signup?'':'active')+'">تسجيل الدخول</button>'+
  '<button type="button" data-action="student-auth-mode" data-mode="signup" class="'+(signup?'active':'')+'">حساب جديد</button></div>'+
  '<form id="student-login-form">'+
  (signup?'<div class="label-group"><label for="student-name">اسم الطالب</label><input class="field" id="student-name" required maxlength="80" minlength="2" autocomplete="name"></div>'+
   '<div class="label-group"><label for="student-grade">الصف الدراسي</label><input class="field" id="student-grade" maxlength="90" placeholder="مثل: الصف الرابع الابتدائي"></div>':'')+
  '<div class="label-group"><label for="student-email">البريد الإلكتروني</label><input class="field" id="student-email" type="email" required autocomplete="email"></div>'+
  '<div class="label-group"><label for="student-password">كلمة المرور</label><input class="field" id="student-password" type="password" required minlength="8" autocomplete="'+(signup?'new-password':'current-password')+'"></div>'+
  '<button class="btn" type="submit" '+(st.busy?'disabled':'')+'>'+(signup?'إنشاء حساب الطالب':'تسجيل الدخول')+'</button></form>'+
  '<p class="helper">بعد التسجيل، أكّد البريد من الرسالة المرسلة لك. لا تشارك كلمة المرور مع أي شخص.</p>'+
  '<p class="helper">معلم؟ <a href="/">افتح بوابة المعلم</a></p></section></div>';
}
function studentStudyHTML(){
 const summary=st.study;
 let result='';
 if(summary){
  result='<section class="card"><h2>✅ '+studentEscape(summary.title)+'</h2>'+
   '<h3>ملخص الدرس</h3><div class="summary">'+studentEscape(summary.summary)+'</div>'+
   (summary.keyPoints?.length?'<h3 style="margin-top:19px">أهم النقاط</h3><ul class="bullets">'+summary.keyPoints.map(p=>'<li>'+studentEscape(p)+'</li>').join('')+'</ul>':'')+
   (summary.flashcards?.length?'<h3>بطاقات مراجعة</h3><div class="flashcards">'+
    summary.flashcards.map(f=>'<div class="flash"><strong>'+studentEscape(f.front)+'</strong><span>'+studentEscape(f.back)+'</span></div>').join('')+'</div>':'')+'</section>';
  if(summary.questions?.length){
    result+='<section class="card"><h2>🧠 اختبر نفسك في الدرس</h2>'+
      summary.questions.map((q,i)=>
       '<fieldset class="quiz-q"><legend>'+(i+1)+'. '+studentEscape(q.text)+'</legend>'+
       q.options.map((opt,k)=>'<label class="choice"><input name="study-q'+i+'" type="radio" value="'+k+'">'+studentEscape(opt)+'</label>').join('')+
       (st.studyReview?'<p class="notice">'+studentEscape(st.studyReview[i]||'')+'</p>':'')+
       '</fieldset>').join('')+
      '<button class="btn secondary" data-action="student-study-check">✅ صحّح إجاباتي</button></section>';
  }
 }
 return '<section class="card"><h2>📚 ذاكر والذكاء الاصطناعي يلخّص لك</h2>'+
  '<p class="helper">الصق نص درس من كتابك، أو اختر ملف PDF صغير يحتوي على نص واضح. هتطلع لك خلاصة، أهم النقاط، وبطاقات مراجعة وأسئلة تدريب.</p>'+
  '<form id="student-study-form">'+
  '<div class="grid-two">'+
    '<div class="label-group"><label for="study-subject">المادة</label><input class="field" id="study-subject" maxlength="90" value="'+studentEscape(st.subject)+'" placeholder="العلوم"></div>'+
    '<div class="label-group"><label for="study-grade">الصف الدراسي</label><input class="field" id="study-grade" maxlength="90" value="'+studentEscape(st.grade)+'"></div>'+
  '</div><div class="label-group"><label for="study-lesson">نص الدرس (90 إلى 7000 حرف)</label>'+
  '<textarea class="field" id="study-lesson" required minlength="90" maxlength="7000" placeholder="اكتب نص الدرس هنا...">'+studentEscape(st.lesson)+'</textarea></div>'+
  '<div class="label-group"><label for="study-pdf">أو استخرج النص من PDF (درس صغير — 8MB أو أقل)</label>'+
  '<input class="field" id="study-pdf" accept="application/pdf,.pdf" type="file"></div>'+
  '<div class="controls"><button class="btn" type="submit" '+(st.busy?'disabled':'')+'>✨ '+(st.busy?'جارٍ تجهيز المراجعة...':'لخّص الدرس واعملي اختبار')+'</button>'+
  '<span class="helper">المحاولات تُحتسب من حصة الطالب اليومية، ولا يشترط اشتراك مدفوع.</span></div>'+
  '</form></section>'+result;
}
function studentQuizHTML(){
 const quiz=st.quiz;
 let body='';
 if(quiz){
  body='<section class="card"><h2>'+studentEscape(quiz.title)+'</h2>'+
   '<p class="helper">'+studentEscape(quiz.subject)+' · '+studentEscape(quiz.grade)+' · '+quiz.questionCount+' سؤال</p>';
  if(st.attempt){
    body+='<div class="notice"><strong>✅ أنت حلّيت الامتحان بالفعل.</strong>'+
     '<p class="big">النتيجة: '+st.attempt.correctCount+' من '+st.attempt.questionCount+' — '+st.attempt.scorePercent+'%</p>'+
     '<p>تقدر ترجع لقسم نتائجي لمتابعة مستواك.</p></div></section>';
  }else{
    body+='<form id="student-quiz-form">'+quiz.questions.map((q,i)=>
      '<fieldset class="quiz-q"><legend>'+(i+1)+'. '+studentEscape(q.text)+'</legend>'+
      q.options.map((opt,k)=>'<label class="choice"><input type="radio" name="quiz-'+studentEscape(q.id)+
      '" value="'+k+'">'+studentEscape(opt)+'</label>').join('')+'</fieldset>').join('')+
      '<button class="btn" type="submit" '+(st.busy?'disabled':'')+'>📩 تسليم الامتحان وعرض الدرجة</button>'+
      '<p class="helper">كل طالب يسلّم الامتحان مرة واحدة. يمكنك ترك سؤال بدون إجابة وسيُحسب خطأ.</p>'+
      '</form></section>';
  }
 }
 return '<section class="card"><h2>✏️ حل امتحان من معلمك</h2><p>اطلب كود الامتحان من معلمك أو افتح الرابط اللي بعته لك.</p>'+
  '<form id="student-code-form"><div class="label-group"><label for="student-quiz-code">كود الامتحان (12 حرفًا ورقمًا)</label>'+
  '<input class="field" id="student-quiz-code" maxlength="12" autocomplete="off" dir="ltr" style="letter-spacing:2px" value="'+studentEscape(st.code)+'"></div>'+
  '<button class="btn" type="submit" '+(st.busy?'disabled':'')+'>فتح الامتحان</button></form></section>'+body;
}
function studentResultsHTML(){
 const rows=st.results;
 return '<section class="card"><div class="controls" style="justify-content:space-between"><h2>📈 نتائجي السابقة</h2>'+
  '<button class="btn secondary" data-action="student-reload-results">↻ تحديث</button></div>'+
  '<p class="helper">هنا تظهر امتحانات المعلمين اللي حلّيتها على ورقة، ودرجتك في كل واحد.</p>'+
  (rows===null?'<p class="loading">جارٍ تحميل النتائج...</p>':
  !rows.length?'<div class="empty">لسه ما حلّيتش أي امتحان. اطلب كود من معلمك وابدأ!</div>':
  rows.map(x=>'<div class="result-item"><div><strong>'+studentEscape(x.title)+'</strong>'+
   '<p class="helper" style="margin:2px 0">'+studentEscape(x.subject)+' · '+studentDate(x.submittedAt)+' · '+x.correctCount+'/'+x.questionCount+' إجابة صحيحة</p>'+
   '<div class="scorebar"><span style="width:'+Math.max(0,Math.min(100,x.scorePercent))+'%"></span></div></div>'+
   '<strong class="score">'+x.scorePercent+'%</strong></div>').join(''))+'</section>';
}
async function studentApi(endpoint,options={}){
 const session=await st.client.auth.getSession();
 const token=session.data?.session?.access_token;
 if(!token)throw new Error('جلسة الطالب انتهت. سجل دخولك مرة أخرى.');
 const response=await fetch(endpoint,{
  ...options,
  headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...options.headers},
  cache:'no-store'
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||'تعذر الاتصال بالخادم');
 return data;
}
async function studentResolveAccount(user){
 const {data,error}=await st.client.from('waraqa_accounts').select('role,display_name').eq('user_id',user.id).single();
 if(error||!data?.role)throw new Error('تعذر تحديد نوع الحساب. تأكد من تفعيل بوابة الطلاب في Supabase.');
 st.user=user;
 st.account={role:data.role,name:data.display_name||user.user_metadata?.full_name||'الطالب'};
 st.grade=String(user.user_metadata?.student_grade||'').slice(0,90);
 studentAlert('');
 studentRender();
 if(studentSignedIn()&&st.code&&/^[A-F0-9]{12}$/i.test(st.code)){
  st.view='quiz';studentRender();
  await studentLoadQuiz();
 }
}
async function studentSignIn(event){
 event?.preventDefault();
 if(st.busy||!st.client)return;
 const email=studentEl('student-email')?.value.trim().toLowerCase();
 const password=studentEl('student-password')?.value||'';
 const signup=st.mode==='signup';
 const name=studentEl('student-name')?.value.trim()||'';
 const grade=studentEl('student-grade')?.value.trim()||'';
 if(!email||password.length<8||(signup&&name.length<2))return studentAlert('اكتب البيانات كاملة. كلمة المرور 8 أحرف على الأقل.');
 st.busy=true;studentAlert('جارٍ '+(signup?'إنشاء الحساب...':'تسجيل الدخول...'));studentRender();
 try{
  const response=signup?await st.client.auth.signUp({
    email,password,
    options:{
      data:{full_name:name,waraqa_role:'student',student_grade:grade.slice(0,90)},
      emailRedirectTo:location.origin+'/student.html'+(st.code?'?code='+encodeURIComponent(st.code):'')
    }
  }):await st.client.auth.signInWithPassword({email,password});
  if(response.error)throw response.error;
  if(signup&&!response.data.session){
    st.mode='login';
    studentAlert('✅ أرسلنا رابط التأكيد لبريدك. افتحه، ثم سجّل الدخول من بوابة الطلاب.');
    return;
  }
  if(!response.data.user)throw new Error('تعذر الدخول للحساب. تحقق من البريد.');
  await studentResolveAccount(response.data.user);
 }catch(error){studentAlert('⚠️ '+(error.message||'تعذر تسجيل الدخول'))}
 finally{
  st.busy=false;studentRender();
  // The auth form was busy during first login, so open a shared exam code now.
  if(studentSignedIn()&&st.view==='quiz'&&st.code&&!st.quiz)
   await studentLoadQuiz();
 }
}
async function studentLogout(){
 await st.client?.auth.signOut();
 st.user=null;st.account=null;st.study=null;st.quiz=null;st.attempt=null;st.results=null;
 studentAlert('');studentRender();
}
async function studentMakeStudy(event){
 event?.preventDefault();
 if(st.busy||!studentSignedIn())return;
 st.subject=studentEl('study-subject')?.value.trim()||'';
 st.grade=studentEl('study-grade')?.value.trim()||'';
 st.lesson=studentEl('study-lesson')?.value||'';
 if(st.lesson.trim().length<90||st.lesson.length>7000)return studentAlert('اكتب نص الدرس من 90 إلى 7000 حرف.');
 st.busy=true;st.studyReview=null;studentRender();
 studentAlert('⏳ جارٍ تلخيص الدرس وإعداد أسئلة المراجعة...');
 try{
  st.study=await studentApi('/api/student-study',{
   method:'POST',body:JSON.stringify({subject:st.subject,grade:st.grade,lesson:st.lesson})
  });
  studentAlert('✅ جاهز! راجع ملخص الدرس وجرّب تحل الأسئلة اللي تحته.');
 }catch(error){studentAlert('⚠️ '+error.message)}
 finally{st.busy=false;studentRender()}
}
async function studentLoadQuiz(){
 if(st.busy)return;
 const code=String(studentEl('student-quiz-code')?.value||st.code).trim().toUpperCase();
 if(!/^[A-F0-9]{12}$/.test(code))return studentAlert('اكتب كود امتحان مكوّن من 12 حرفًا ورقمًا.');
 st.code=code;st.quiz=null;st.attempt=null;st.busy=true;studentRender();
 try{
  const data=await studentApi('/api/student-quizzes?code='+encodeURIComponent(code));
  st.quiz=data.quiz;st.attempt=data.attempt;
  studentAlert(st.attempt?'✅ سبق وحلّيت هذا الامتحان، ودي درجتك.':'✅ الامتحان جاهز. اقرأ الأسئلة كويس قبل التسليم.');
 }catch(error){studentAlert('⚠️ '+error.message)}
 finally{st.busy=false;studentRender()}
}
async function studentSubmitQuiz(event){
 event?.preventDefault();
 if(st.busy||!st.quiz||st.attempt)return;
 const answers={};
 for(const q of st.quiz.questions){
  const selected=document.querySelector('input[name="quiz-'+q.id+'"]:checked');
  if(selected)answers[q.id]=Number(selected.value);
 }
 if(!confirm('متأكد من تسليم الامتحان؟ التسليم مرة واحدة فقط.'))return;
 st.busy=true;studentRender();
 try{
  const result=await studentApi('/api/student-quizzes',{
   method:'POST',body:JSON.stringify({code:st.code,responses:answers})
  });
  st.attempt=result.attempt;
  st.results=null;
  studentAlert('🎉 تم تسليم الامتحان وتصحيحه. نتيجتك ظهرت تحت.');
 }catch(error){studentAlert('⚠️ '+error.message)}
 finally{st.busy=false;studentRender()}
}
async function studentFetchResults(){
 if(!studentSignedIn())return;
 st.results=null;studentRender();
 try{
  const data=await studentApi('/api/student-quizzes?history=1');
  st.results=data.attempts||[];
 }catch(error){st.results=[];studentAlert('⚠️ '+error.message)}
 studentRender();
}
function studentCheckStudy(){
 if(!st.study?.questions?.length)return;
 st.studyReview=st.study.questions.map((q,i)=>{
  const ans=document.querySelector('input[name="study-q'+i+'"]:checked');
  const picked=ans?Number(ans.value):-1;
  return (picked===q.correctIndex?'✅ إجابة صحيحة. ':'❌ الإجابة الصحيحة: '+q.options[q.correctIndex]+'. ')+q.explanation;
 });
 studentRender();
}
async function studentParsePDF(file){
 if(!file)return;
 if(file.size>8*1024*1024)return studentAlert('ملف PDF كبير. الحد 8 ميجابايت للدرس الواحد.');
 st.pdfLoading=true;studentAlert('⏳ جارٍ استخراج نص صفحات PDF على جهازك...');
 try{
  if(!window.pdfjsLib){
   await new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload=resolve;script.onerror=()=>reject(new Error('تعذر تحميل قارئ PDF'));document.head.appendChild(script);
   });
  }
  window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false}).promise;
  try{
   if(pdf.numPages>15)throw new Error('الملف طويل؛ اختار درسًا واحدًا من 15 صفحة أو أقل.');
   const sections=[];
   for(let i=1;i<=pdf.numPages;i++){
    const page=await pdf.getPage(i);
    const content=await page.getTextContent();
    const text=(content.items||[]).map(x=>x.str||'').join(' ');
    if(text.trim())sections.push(text);
    page.cleanup();
   }
   const full=sections.join('\n\n');
   if(full.trim().length<90)throw new Error('ملف PDF مصوّر أو نصه قليل. استخدم درسًا نصيًا أو الصق النص يدويًا.');
   if(full.length>7000)throw new Error('الدرس أطول من الحد المسموح. اختار ملفًا أصغر أو الصق الجزء المطلوب فقط.');
   st.lesson=full;
   studentAlert('✅ قرأنا نص الدرس محليًا. راجعه ثم اضغط «لخّص الدرس».');
  }finally{await pdf.destroy()}
 }catch(error){studentAlert('⚠️ '+error.message)}
 finally{st.pdfLoading=false;studentRender()}
}
async function studentInitialize(){
 try{
  const response=await fetch('/api/config',{cache:'no-store'});
  if(!response.ok)throw new Error('إعدادات المنصة غير متاحة');
  st.config=await response.json();
  if(!st.config.studentPortalEnabled){studentRender();return}
  if(!window.supabase?.createClient)throw new Error('تعذر تحميل نظام تسجيل الدخول');
  st.client=window.supabase.createClient(st.config.supabaseUrl,st.config.supabaseKey,{
   auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  const {data}=await st.client.auth.getUser();
  if(data?.user)await studentResolveAccount(data.user);
  st.client.auth.onAuthStateChange(event=>{
    if(event==='SIGNED_OUT'){
      st.user=null;st.account=null;st.quiz=null;st.attempt=null;st.results=null;studentRender();
    }
  });
  studentRender();
 }catch(error){
  st.config=st.config||{studentPortalEnabled:true};
  studentAlert('⚠️ '+error.message);
  studentRender();
 }
}
document.addEventListener('submit',async event=>{
 const id=event.target?.id;
 if(id==='student-login-form')return studentSignIn(event);
 if(id==='student-study-form')return studentMakeStudy(event);
 if(id==='student-code-form'){event.preventDefault();return studentLoadQuiz()}
 if(id==='student-quiz-form')return studentSubmitQuiz(event);
});
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-action]');
 if(!button)return;
 event.preventDefault();
 const action=button.dataset.action;
 if(action==='student-auth-mode'){st.mode=button.dataset.mode;studentAlert('');studentRender();return}
 if(action==='student-tab'){
  st.view=button.dataset.view;
  studentRender();
  if(st.view==='results')return studentFetchResults();
  return;
 }
 if(action==='student-logout')return studentLogout();
 if(action==='student-reload-results')return studentFetchResults();
 if(action==='student-study-check')return studentCheckStudy();
});
document.addEventListener('input',event=>{
 const id=event.target?.id;
 if(id==='study-lesson')st.lesson=event.target.value;
 if(id==='study-grade')st.grade=event.target.value;
 if(id==='study-subject')st.subject=event.target.value;
 if(id==='student-quiz-code')st.code=event.target.value;
});
document.addEventListener('change',event=>{
 if(event.target?.id==='study-pdf')studentParsePDF(event.target.files?.[0]);
});
document.addEventListener('DOMContentLoaded',studentInitialize);
