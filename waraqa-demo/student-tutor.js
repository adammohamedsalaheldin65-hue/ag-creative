/* Waraqa student photo tutor — isolated, client-only lesson session.
   Supabase JWT and quota are checked by /api/student-tutor on every AI call.
   No Gemini key or Supabase service key is included here. */
'use strict';

const tutor={
 images:[], subject:'', grade:'', sourceText:'',
 lesson:null,step:0,gameAnswers:{},busy:false,
 question:'',answers:[],examSubmitted:false,
 askAnswer:null,notice:''
};

function tutorReset(){
 tutor.images=[];tutor.subject='';tutor.grade='';tutor.sourceText='';
 tutor.lesson=null;tutor.step=0;tutor.gameAnswers={};tutor.busy=false;
 tutor.question='';tutor.answers=[];tutor.examSubmitted=false;tutor.askAnswer=null;tutor.notice='';
}

function tutorSteps(){
 const data=tutor.lesson;
 if(!data)return [];
 const steps=[];
 for(let i=0;i<data.sections.length;i++){
  steps.push({kind:'section',index:i});
  if(i<data.games.length)steps.push({kind:'game',index:i});
 }
 for(let i=data.sections.length;i<data.games.length;i++)steps.push({kind:'game',index:i});
 return steps;
}

function tutorImageHTML(){
 if(!tutor.images.length)return '<p class="helper">لسه مرفعتش صور. تقدر تصور بالكاميرا أو تختار صور من المعرض.</p>';
 return '<div class="tutor-thumbs">'+tutor.images.map((im,i)=>
  '<div class="tutor-thumb"><img loading="lazy" alt="الصفحة '+(i+1)+'" src="'+im.data+'">'+
  '<button type="button" class="btn outline" data-action="tutor-remove-photo" data-index="'+i+'">✕ حذف</button></div>'
 ).join('')+'</div>';
}

function tutorViewHTML(){
 let out='<section class="card"><h2>📸 اتعلّم من تصوير الكتاب</h2>'+
  '<p>صوّر صفحات الدرس، وورقة هتشرحها خطوة خطوة، مع ألعاب ذهنية وسط الشرح، وبعدها امتحان اختيار ومقالي من الصفحات المرفوعة.</p>'+
  '<div class="notice warn">الشرح والامتحان مبنيّان على الصفحات اللي صورتها فقط؛ ممكن تفوت تفاصيل لو الصور غير واضحة. لتحضير امتحان المنهج كله لازم تدخل جميع الدروس. حصة الطالب طلبان AI يوميًا: إعداد الدرس طلب، وسؤال المتابعة طلب آخر. الصور تُرسل إلى Gemini لتحليلها؛ تجنّب تصوير أسماء الطلاب أو أي معلومات شخصية. هذه جلسة مذاكرة مؤقتة وليست امتحانًا رسميًا محفوظًا.</div>'+
  '<form id="tutor-lesson-form"><div class="grid-two">'+
  '<div class="label-group"><label for="tutor-subject">المادة</label><input class="field" id="tutor-subject" maxlength="90" value="'+studentEscape(tutor.subject)+'" placeholder="العلوم"></div>'+
  '<div class="label-group"><label for="tutor-grade">الصف الدراسي</label><input class="field" id="tutor-grade" maxlength="90" value="'+studentEscape(tutor.grade||st.grade||'')+'" placeholder="الرابع الابتدائي"></div></div>'+
  '<div class="label-group"><label for="tutor-camera">📷 تصوير صفحة بالكاميرا</label>'+
  '<input id="tutor-camera" class="field" type="file" accept="image/*" capture="environment"></div>'+
  '<div class="label-group"><label for="tutor-gallery">🖼️ اختيار صور صفحات من الموبايل</label>'+
  '<input id="tutor-gallery" class="field" type="file" accept="image/jpeg,image/png,image/webp" multiple></div>'+
  tutorImageHTML()+
  '<div class="label-group"><label for="tutor-source">أو الصق نص الدرس (اختياري مع الصور)</label>'+
  '<textarea id="tutor-source" class="field" maxlength="6000" placeholder="لو مش هتصور، اكتب هنا 90 حرفًا على الأقل...">'+studentEscape(tutor.sourceText)+'</textarea></div>'+
  '<div class="controls"><button class="btn" type="submit" '+(tutor.busy?'disabled':'')+'>'+
  (tutor.busy?'⏳ جارٍ قراءة الصور وإعداد الدرس...':'✨ ابدأ الشرح والألعاب والامتحان')+'</button>'+
  '<span class="helper">حتى 10 صور للدرس. الأفضل صور صفحات واضحة مع إضاءة قوية؛ هيتم ضغط الصور تلقائيًا.</span></div></form></section>';
 if(!tutor.lesson)return out;
 const l=tutor.lesson;
 out+='<section class="card"><h2>📖 '+studentEscape(l.title)+'</h2>'+
  (l.sourceCoverage?'<p class="helper">تغطية المصدر: '+studentEscape(l.sourceCoverage)+'</p>':'')+
  (l.unreadable?.length?'<div class="notice warn">⚠️ أجزاء محتاجة صورة أوضح: '+l.unreadable.map(studentEscape).join(' — ')+'</div>':'');
 const steps=tutorSteps();
 if(tutor.step<steps.length){
  const current=steps[tutor.step];
  out+='<div class="tutor-progress">مرحلة '+(tutor.step+1)+' من '+steps.length+
   '<div class="scorebar"><span style="width:'+Math.round(100*tutor.step/steps.length)+'%"></span></div></div>';
  if(current.kind==='section'){
   const s=l.sections[current.index];
   out+='<h3>📚 '+studentEscape(s.title)+'</h3>'+
    '<div class="summary">'+studentEscape(s.explanation)+'</div>'+
    (s.example?'<p class="notice"><strong>مثال:</strong> '+studentEscape(s.example)+'</p>':'')+
    '<button type="button" class="btn" data-action="tutor-next">فهمت، كمل الشرح ←</button>';
  }else{
   const g=l.games[current.index],picked=tutor.gameAnswers[current.index];
   out+='<h3>🎮 تحدّي ذهني '+(current.index+1)+'</h3><p><strong>'+studentEscape(g.text)+'</strong></p>';
   out+=g.options.map((o,i)=>'<button type="button" class="tutor-game-option'+
     (picked===i?' selected':'')+'" data-action="tutor-pick" data-index="'+i+'" '+(picked!==undefined?'disabled':'')+'>'+
     studentEscape(o)+'</button>').join('');
   if(picked!==undefined){
    out+='<div class="notice '+(picked===g.correctIndex?'':'warn')+'">'+
     (picked===g.correctIndex?'✅ ممتاز! إجابتك صح.':'❌ خلينا نفهم الإجابة الصح: '+studentEscape(g.options[g.correctIndex]))+
     (g.explanation?' — '+studentEscape(g.explanation):'')+'</div>'+
     '<button class="btn" type="button" data-action="tutor-next">يلا نكمل ←</button>';
   }
  }
  return out+'</section>';
 }
 out+='<div class="notice">🎉 خلّصت الشرح والألعاب! اسأل عن اللي مش فاهمه، وبعدها امتحن نفسك.</div></section>';
 out+='<section class="card"><h2>💬 اسأل ورقة عن أي جزء مش فاهمه</h2>'+
  '<p class="helper">اسأل سؤالًا من الصفحات اللي رفعتها. السؤال بيستخدم طلبًا من حصة الذكاء الاصطناعي اليومية.</p>'+
  '<form id="tutor-ask-form"><div class="label-group"><label for="tutor-question">إيه النقطة اللي محتاج شرحها؟</label>'+
  '<textarea id="tutor-question" class="field" minlength="5" maxlength="600" required placeholder="مثال: ممكن تشرحلي الفكرة التانية بمثال أسهل؟">'+studentEscape(tutor.question)+'</textarea></div>'+
  '<button class="btn secondary" type="submit" '+(tutor.busy?'disabled':'')+'>'+(tutor.busy?'⏳ بفكر في شرح مناسب...':'🤔 اشرحلي الجزئية دي')+'</button></form>'+
  (tutor.askAnswer?'<div class="tutor-answer"><strong>رد ورقة:</strong><div class="summary">'+studentEscape(tutor.askAnswer.answer)+'</div>'+
   (tutor.askAnswer.example?'<p><strong>مثال:</strong> '+studentEscape(tutor.askAnswer.example)+'</p>':'')+
   (tutor.askAnswer.followup?'<p><strong>سؤال للتأكد من الفهم:</strong> '+studentEscape(tutor.askAnswer.followup)+'</p>':'')+'</div>':'')+
  '</section>';
 out+=tutorExamHTML();
 return out;
}

function tutorExamHTML(){
 const exam=tutor.lesson?.exam;
 if(!exam)return '';
 let html='<section class="card" id="tutor-exam"><h2>📝 امتحان على الدرس من الموبايل</h2>'+
  '<p class="helper">اختيار من متعدد + أسئلة مقالية. اختيار من متعدد بيتصحح تلقائيًا، والمقالي هتشوف له إجابة نموذجية ونقاط تقييم، ودرجته النهائية تحتاج مراجعة معلم.</p>';
 if(!tutor.examSubmitted){
  html+='<form id="tutor-exam-form">';
  for(let i=0;i<exam.mcq.length;i++){
   const q=exam.mcq[i];
   html+='<fieldset class="quiz-q"><legend>'+(i+1)+'. '+studentEscape(q.text)+'</legend>';
   html+=q.options.map((option,j)=>'<label class="choice"><input type="radio" name="tutor-mcq-'+i+'" value="'+j+'" '+(tutor.answers[i]===j?'checked':'')+'>'+studentEscape(option)+'</label>').join('');
   html+='</fieldset>';
  }
  for(let i=0;i<exam.essays.length;i++){
   const q=exam.essays[i];
   html+='<div class="quiz-q"><label for="tutor-essay-'+i+'">مقالي '+(i+1)+'. '+studentEscape(q.text)+'</label>'+
    '<textarea class="field" id="tutor-essay-'+i+'" name="tutor-essay-'+i+'" maxlength="2400" rows="4" placeholder="اكتب إجابتك بنفسك قبل التصحيح...">'+studentEscape(tutor.answers['essay'+i]||'')+'</textarea></div>';
  }
  return html+'<button class="btn" type="submit">✅ سلّم الامتحان وشوف النتيجة</button></form></section>';
 }
 const total=exam.mcq.length;
 const correct=exam.mcq.filter((q,i)=>tutor.answers[i]===q.correctIndex).length;
 html+='<p class="notice"><strong>نتيجة الاختيار:</strong> '+correct+' من '+total+
  ' ('+Math.round(correct*100/(total||1))+'%). الأسئلة المقالية غير محسوبة في النسبة.</p>';
 for(let i=0;i<exam.mcq.length;i++){
  const q=exam.mcq[i],picked=tutor.answers[i];
  html+='<div class="quiz-q"><strong>'+studentEscape(q.text)+'</strong>'+
   '<p>'+((picked===q.correctIndex)?'✅ إجابة صحيحة':'❌ إجابة غير صحيحة أو لم تُجب')+
   ' — الإجابة: '+studentEscape(q.options[q.correctIndex])+'</p>'+
   (q.explanation?'<p class="helper">'+studentEscape(q.explanation)+'</p>':'')+'</div>';
 }
 for(let i=0;i<exam.essays.length;i++){
  const q=exam.essays[i],answer=tutor.answers['essay'+i]||'';
  html+='<div class="quiz-q"><strong>مقالي '+(i+1)+': '+studentEscape(q.text)+'</strong>'+
   '<p>إجابتك: '+studentEscape(answer||'لم تتم الإجابة')+'</p>'+
   '<p class="notice"><strong>إجابة نموذجية للمراجعة:</strong> '+studentEscape(q.modelAnswer)+'</p>'+
   '<p><strong>نقاط التقييم:</strong></p><ul class="bullets">'+q.rubric.map(s=>'<li>'+studentEscape(s)+'</li>').join('')+'</ul>'+
   '<p class="helper">قارن إجابتك بالنقاط؛ التصحيح المقالي النهائي يحتاج مراجعة معلم.</p></div>';
 }
 return html+'</section>';
}

function tutorSaveFields(){
 tutor.subject=studentEl('tutor-subject')?.value||tutor.subject;
 tutor.grade=studentEl('tutor-grade')?.value||tutor.grade;
 tutor.sourceText=studentEl('tutor-source')?.value||tutor.sourceText;
}

function tutorToast(text){
 tutor.notice=String(text||'');
 studentAlert(tutor.notice);
}

async function tutorAddPhotos(files){
 if(tutor.busy||!files?.length)return;
 if(tutor.images.length+files.length>10)
  return tutorToast('⚠️ الحد الأقصى 10 صور للدرس الواحد. احذف صورة قبل إضافة غيرها.');
 tutorSaveFields();
 const valid=[];
 for(const file of files){
  if(!/^image\/(?:jpeg|png|webp)$/.test(file.type))
   return tutorToast('⚠️ استخدم JPEG أو PNG أو WEBP فقط.');
  if(file.size>12*1024*1024)
   return tutorToast('⚠️ الصورة أكبر من 12 ميجابايت. اختار حجمًا أصغر.');
  valid.push({file,name:String(file.name||'صفحة').slice(0,100)});
 }
 if(!valid.length)return;
 // Keep a File reference in local JS only. The request sends *only* the
 // compressed data URLs, never raw photos or filenames.
 const pending=[...tutor.images.map(im=>({file:im.file,name:im.name})),...valid];
 tutor.busy=true;
 studentRender();
 tutorToast('⏳ بنجهز '+pending.length+' صور. جودة كل صورة هتتظبط حسب العدد...');
 try{
  // Recompress earlier photos when more are added. This keeps the entire
  // request below the API's fixed ~3.25M character image budget.
  const charBudget=Math.floor(3_200_000/pending.length);
  const ready=[];
  for(const item of pending){
   if(!item.file)throw new Error('الصورة السابقة لم تعد متاحة. أعد اختيار صور الكتاب.');
   const data=await tutorCompressImage(item.file,charBudget);
   ready.push({data,file:item.file,name:item.name});
  }
  if(ready.reduce((sum,im)=>sum+im.data.length,0)>3_250_000)
   throw new Error('الحجم الإجمالي كبير؛ استخدم صورًا أقل.');
  tutor.images=ready;
  tutorToast('✅ جاهز: '+tutor.images.length+' من 10 صور. تقدر تضيف كمان أو تبدأ الشرح.');
 }catch(error){
  tutorToast('⚠️ '+(error?.message||'تعذر تجهيز بعض الصور. جرّب عددًا أقل.'));
 }finally{
  tutor.busy=false;
  studentRender();
 }
}

function tutorCompressImage(file,maxCharacters){
 return new Promise((resolve,reject)=>{
  const img=new Image();
  const blobURL=URL.createObjectURL(file);
  img.onload=()=>{
   try{
    if(!img.naturalWidth||!img.naturalHeight)throw new Error('الصورة غير واضحة أو تالفة.');
    const canvas=document.createElement('canvas');
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('تعذر تجهيز الصورة على الجهاز.');
    // Start at legible resolution. Reduce resolution and JPEG quality only
    // as needed to fit ten pictures in a single limited Gemini request.
    const attempts=[
     [1700,.83],[1600,.78],[1500,.74],[1400,.7],
     [1300,.67],[1200,.63],[1100,.60],[1000,.57],[900,.52]
    ];
    for(const [maxSide,quality] of attempts){
     const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
     canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
     canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
     ctx.fillStyle='#fff';
     ctx.fillRect(0,0,canvas.width,canvas.height);
     ctx.drawImage(img,0,0,canvas.width,canvas.height);
     const data=canvas.toDataURL('image/jpeg',quality);
     if(data.startsWith('data:image/jpeg;base64,')&&data.length<=maxCharacters){
      resolve(data);
      return;
     }
    }
    throw new Error('تفاصيل بعض الصور كتير. جرّب تصوير الجزء المطلوب فقط أو ارفع صورًا أقل.');
   }catch(error){reject(error)}
   finally{URL.revokeObjectURL(blobURL)}
  };
  img.onerror=()=>{URL.revokeObjectURL(blobURL);reject(new Error('تعذر قراءة ملف الصورة.'))};
  img.src=blobURL;
 });
}

async function tutorStart(event){
 event?.preventDefault();
 if(!studentSignedIn()||tutor.busy)return;
 tutorSaveFields();
 if(!tutor.images.length&&tutor.sourceText.trim().length<90){
  return tutorToast('⚠️ صوّر صفحة واحدة على الأقل، أو اكتب 90 حرف من الدرس.');
 }
 if(!confirm('هنبدأ درس جديد من الصفحات الحالية. هيتحسب طلب من محاولات الذكاء الاصطناعي اليومية، والدرس السابق هيتشال من الشاشة. نكمل؟'))return;
 tutor.busy=true;studentRender();
 tutorToast('⏳ ورقة بتقرأ الكتاب وتحضّر الشرح والألعاب والامتحان...');
 try{
  const data=await studentApi('/api/student-tutor',{method:'POST',
   body:JSON.stringify({action:'lesson',subject:tutor.subject,grade:tutor.grade,
    sourceText:tutor.sourceText,images:tutor.images.map(im=>({data:im.data}))})});
  tutor.lesson=data;tutor.step=0;tutor.gameAnswers={};tutor.answers=[];
  tutor.examSubmitted=false;tutor.askAnswer=null;tutor.question='';
  tutorToast('✅ الدرس جاهز! اقرأ أول جزء وكمّل الألعاب خطوة خطوة.');
 }catch(error){tutorToast('⚠️ '+error.message)}
 finally{tutor.busy=false;studentRender()}
}

async function tutorAsk(event){
 event?.preventDefault();
 if(!studentSignedIn()||tutor.busy||!tutor.lesson)return;
 tutor.question=studentEl('tutor-question')?.value.trim()||'';
 if(tutor.question.length<5)return tutorToast('اكتب سؤالك أولًا.');
 const context=tutor.lesson.sections.map(s=>s.title+'\n'+s.explanation+'\n'+s.example).join('\n\n').slice(0,6800);
 tutor.busy=true;studentRender();
 tutorToast('⏳ بنبسّط الجزئية اللي سألت عنها...');
 try{
  const output=await studentApi('/api/student-tutor',{method:'POST',
   body:JSON.stringify({action:'ask',question:tutor.question,context})});
  tutor.askAnswer=output;
  tutorToast('✅ شرح السؤال جاهز تحت خانة السؤال.');
 }catch(error){tutorToast('⚠️ '+error.message)}
 finally{tutor.busy=false;studentRender()}
}

function tutorSubmitExam(event){
 event.preventDefault();
 if(!tutor.lesson||tutor.examSubmitted)return;
 const exam=tutor.lesson.exam;
 tutor.answers={};
 exam.mcq.forEach((_,i)=>{
  const checked=document.querySelector('input[name="tutor-mcq-'+i+'"]:checked');
  tutor.answers[i]=checked?Number(checked.value):-1;
 });
 exam.essays.forEach((_,i)=>{
  tutor.answers['essay'+i]=(studentEl('tutor-essay-'+i)?.value||'').trim().slice(0,2400);
 });
 if(!confirm('متأكد إنك عايز تسلّم امتحانك وتشوف الإجابات؟'))return;
 tutor.examSubmitted=true;
 studentRender();
 tutorToast('✅ اتصححت أسئلة الاختيار. راجع النموذج ونقاط تصحيح المقالي تحت.');
}

document.addEventListener('submit',event=>{
 if(event.target?.id==='tutor-lesson-form')return tutorStart(event);
 if(event.target?.id==='tutor-ask-form')return tutorAsk(event);
 if(event.target?.id==='tutor-exam-form')return tutorSubmitExam(event);
});
document.addEventListener('click',event=>{
 const button=event.target?.closest?.('[data-action]');
 if(!button)return;
 const action=button.dataset.action;
 if(!action.startsWith('tutor-'))return;
 event.preventDefault();
 if(tutor.busy||!tutor.lesson&&action!=='tutor-remove-photo')return;
 if(action==='tutor-remove-photo'){
  const i=Number(button.dataset.index);
  if(Number.isInteger(i)&&i>=0&&i<tutor.images.length){
   tutorSaveFields();
   tutor.images.splice(i,1);
   studentRender();
  }
 }else if(action==='tutor-pick'){
  const step=tutorSteps()[tutor.step];
  if(step?.kind!=='game'||tutor.gameAnswers[step.index]!==undefined)return;
  const choice=Number(button.dataset.index);
  const game=tutor.lesson.games[step.index];
  if(!Number.isInteger(choice)||choice<0||choice>=game.options.length)return;
  tutor.gameAnswers[step.index]=choice;studentRender();
 }else if(action==='tutor-next'){
  const steps=tutorSteps();
  const current=steps[tutor.step];
  if(!current)return;
  if(current.kind==='game'&&tutor.gameAnswers[current.index]===undefined)return;
  tutor.step=Math.min(steps.length,tutor.step+1);studentRender();
 }
});
document.addEventListener('change',event=>{
 if(event.target?.id==='tutor-camera'||event.target?.id==='tutor-gallery'){
  const files=Array.from(event.target.files||[]);
  tutorAddPhotos(files);
 }
});
document.addEventListener('input',event=>{
 const id=event.target?.id;
 if(id==='tutor-subject')tutor.subject=event.target.value;
 if(id==='tutor-grade')tutor.grade=event.target.value;
 if(id==='tutor-source')tutor.sourceText=event.target.value;
 if(id==='tutor-question')tutor.question=event.target.value;
});
