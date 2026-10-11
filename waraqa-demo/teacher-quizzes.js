/* Teacher tools: publish saved objective exams to students and view protected results.
   Server verifies source exam ownership and calculates grades; never send answer keys to learners. */
'use strict';
let teacherQuizList=[];
let teacherQuizLoadedFor='';
let teacherQuizLoading=false;
let teacherQuizDetail=null;
let teacherQuizMessage='';
const teacherQuizOriginalEditor=editorHTML;
const teacherQuizOriginalAct=act;
const teacherQuizEscape=E;
function teacherQuizReady(){
 return serviceConfig?.studentPortalEnabled===true &&
   !!state.user && !!state.subscriptionStatus?.access;
}
function teacherQuizUrl(code){
 return location.origin+'/student.html?code='+encodeURIComponent(code);
}
async function teacherQuizApi(path='/api/teacher-quizzes',options={}){
 const response=await fetch(path,{
  ...options,
  headers:{...(await aiHeaders()),...(options.headers||{})},
  cache:'no-store'
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||'حدث خطأ في الاتصال بامتحانات الطلاب');
 return data;
}
function teacherQuizEnsureList(){
 if(!teacherQuizReady())return;
 if(teacherQuizLoadedFor===state.user.ownerId||teacherQuizLoading)return;
 teacherQuizLoading=true;
 const id=state.user.ownerId;
 teacherQuizApi().then(data=>{
  if(state.user?.ownerId!==id)return;
  teacherQuizList=data.quizzes||[];
  teacherQuizLoadedFor=id;
 }).catch(error=>{teacherQuizMessage=error.message}).finally(()=>{
  teacherQuizLoading=false;
  if(state.page==='teacherQuizzes'&&state.user?.ownerId===id)render();
 });
}
function teacherQuizPanel(){
 if(!serviceConfig?.studentPortalEnabled)return '';
 return '<div class="form-card teacher-quiz-panel"><h3>📱 أرسل الامتحان للطلاب</h3>'+
  '<p class="mini-note">انشر أسئلة الاختيار من متعدد فقط برابط خاص. الطالب يجاوب من موبايله، والدرجة تتحسب على الخادم وتظهر لك في النتائج. أسئلة المقال والرسومات غير مدعومة في التصحيح التلقائي حاليًا.</p>'+
  '<button type="button" class="btn btn-primary" data-action="teacher-quiz-publish">🔗 نشر هذا الامتحان للطلاب</button>'+
  '<button type="button" class="btn btn-outline" data-action="go" data-page="teacherQuizzes" style="margin:7px">📊 امتحانات الطلاب ونتائجهم</button></div>';
}
editorHTML=function(){
 const html=teacherQuizOriginalEditor();
 if(!state.exam?.questions?.length)return html;
 const anchor='<div class="notice blue">';
 return html.includes(anchor)?html.replace(anchor,teacherQuizPanel()+anchor):teacherQuizPanel()+html;
};
function teacherQuizHTML(){
 if(!serviceConfig?.studentPortalEnabled)
  return pageHeading('الطلاب','امتحانات الطلاب','الميزة لم تتفعّل بعد في قاعدة البيانات.')+
   '<div class="notice">المالك يحتاج يشغّل student_portal.sql ثم يضيف STUDENT_PORTAL_ENABLED=true في Vercel.</div>';
 teacherQuizEnsureList();
 const rows=teacherQuizList.map(q=>
  '<article class="teacher-quiz-item"><div><h3>'+teacherQuizEscape(q.title)+'</h3>'+
  '<p>'+teacherQuizEscape(q.subject)+' · '+teacherQuizEscape(q.grade)+' · '+q.count+' سؤال</p>'+
  '<div class="teacher-quiz-code">الكود: <strong dir="ltr">'+teacherQuizEscape(q.code)+'</strong> · '+
   (q.enabled?'متاح للطلاب':'متوقف')+'</div></div>'+
  '<div class="teacher-quiz-actions">'+
   '<button class="btn btn-outline btn-sm" data-action="teacher-quiz-copy" data-code="'+teacherQuizEscape(q.code)+'">📋 نسخ الرابط</button>'+
   '<button class="btn btn-outline btn-sm" data-action="teacher-quiz-results" data-id="'+teacherQuizEscape(q.id)+'">📊 النتائج</button>'+
   '<button class="btn btn-outline btn-sm" data-action="teacher-quiz-toggle" data-id="'+teacherQuizEscape(q.id)+'" data-enabled="'+(q.enabled?'false':'true')+'">'+(q.enabled?'إيقاف':'إعادة نشر')+'</button>'+
  '</div></article>'
 ).join('');
 let details='';
 if(teacherQuizDetail){
  const d=teacherQuizDetail;
  const trs=d.attempts.map((a,i)=>
    '<tr><td>'+(i+1)+'</td><td>'+teacherQuizEscape(a.studentName)+'</td><td>'+a.correctCount+' / '+a.questionCount+
    '</td><td><b>'+a.scorePercent+'%</b></td><td>'+new Date(a.submittedAt).toLocaleString('ar-EG')+'</td></tr>'
  ).join('');
  details='<section class="form-card spaced"><h3>📊 نتائج: '+teacherQuizEscape(d.quiz.title)+'</h3>'+
    '<p class="mini-note">يعرض اسم الطالب ونتيجته فقط. لا تُعرض إيميلات الطلاب.</p>'+
    (d.attempts.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>الطالب</th><th>الإجابات الصحيحة</th><th>الدرجة</th><th>التاريخ</th></tr></thead><tbody>'+trs+'</tbody></table></div>':
    '<p>لسه مفيش طلاب حلّوا الامتحان ده.</p>')+'</section>';
 }
 return pageHeading('بوابة المعلم','📊 امتحانات الطلاب','ابعت رابط الامتحان للطلاب وشاهد الدرجات بعد التصحيح التلقائي.')+
   (teacherQuizMessage?'<div class="notice">'+teacherQuizEscape(teacherQuizMessage)+'</div>':'')+
   '<div class="form-card"><h3>امتحانات منشورة ('+teacherQuizList.length+')</h3>'+
   '<p class="mini-note">أنشئ امتحان من قسم «إنشاء امتحان»، راجعه واحفظه، ثم اضغط «نشر هذا الامتحان للطلاب» من صفحة التحرير.</p>'+
   (teacherQuizLoading?'<p>جارٍ تحميل الامتحانات...</p>':rows||'<p>لا توجد امتحانات منشورة حتى الآن.</p>')+
   '</div>'+details;
}
async function teacherQuizPublish(){
 if(!teacherQuizReady())return toast('تحتاج حساب معلم واشتراك نشط لتفعيل الامتحانات.');
 if(!state.exam?.questions?.length)return toast('افتح امتحان فيه أسئلة أولًا.');
 teacherQuizMessage='';
 // Save current edits and re-check ownership on server before publishing.
 await saveExam();
 const d=await teacherQuizApi('/api/teacher-quizzes',{
  method:'POST',body:JSON.stringify({action:'publish',examId:state.exam.id})
 });
 teacherQuizLoadedFor='';teacherQuizDetail=null;
 teacherQuizMessage='✅ تم نشر الامتحان. الكود: '+d.quiz.code+
   (d.skipped?' • استُبعد '+d.skipped+' سؤال غير قابل للتصحيح التلقائي.':'');
 await teacherQuizApi().then(data=>{teacherQuizList=data.quizzes||[];teacherQuizLoadedFor=state.user.ownerId});
 state.page='teacherQuizzes';render();window.scrollTo(0,0);
 toast('✅ تم نشر الامتحان للطلاب. انسخ الرابط لإرساله.');
}
async function teacherQuizResult(id){
 const response=await teacherQuizApi('/api/teacher-quizzes?id='+encodeURIComponent(id));
 teacherQuizDetail=response;render();
}
async function teacherQuizToggle(id,enabled){
 if(!confirm(enabled?'هل تريد إعادة فتح هذا الامتحان للطلاب؟':'هل تريد إيقاف هذا الامتحان عن الطلاب الجدد؟'))return;
 await teacherQuizApi('/api/teacher-quizzes',{
  method:'POST',body:JSON.stringify({action:'toggle',id,enabled})
 });
 teacherQuizLoadedFor='';teacherQuizDetail=null;
 teacherQuizList=(await teacherQuizApi()).quizzes||[];
 teacherQuizLoadedFor=state.user.ownerId;
 render();
}
act=async function(action,button){
 if(action==='teacher-quiz-publish')return teacherQuizPublish();
 if(action==='teacher-quiz-results')return teacherQuizResult(button.dataset.id);
 if(action==='teacher-quiz-toggle')return teacherQuizToggle(button.dataset.id,button.dataset.enabled==='true');
 if(action==='teacher-quiz-copy'){
  const text=teacherQuizUrl(button.dataset.code);
  if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);
  else prompt('انسخ الرابط ده:',text);
  return toast('✅ رابط الامتحان جاهز للمشاركة.');
 }
 if(action==='logout'){teacherQuizList=[];teacherQuizLoadedFor='';teacherQuizDetail=null;}
 return teacherQuizOriginalAct(action,button);
};
const teacherQuizStyles=document.createElement('style');
teacherQuizStyles.textContent=`
.teacher-quiz-panel{margin:0 0 16px;padding:17px 20px}
.teacher-quiz-panel h3{font-size:17px;margin:0 0 8px}
.teacher-quiz-item{border-bottom:1px solid #e8ebf4;padding:16px 4px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
.teacher-quiz-item h3{margin:0;font-size:16px}.teacher-quiz-item p{font-size:12px;color:#7d8499;margin:6px 0}
.teacher-quiz-code{background:#f1efff;color:#38317d;border-radius:9px;padding:9px 11px;font-size:13px}
.teacher-quiz-code strong{font-family:monospace;letter-spacing:1px}
.teacher-quiz-actions{display:flex;flex-wrap:wrap;gap:6px}
@media(max-width:620px){.teacher-quiz-item{align-items:stretch}.teacher-quiz-actions{width:100%}.teacher-quiz-actions button{flex:1}}
`;
document.head.appendChild(teacherQuizStyles);
