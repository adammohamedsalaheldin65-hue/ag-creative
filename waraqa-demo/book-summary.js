/* Waraqa: whole PDF textbook summarizer.
   PDF/OCR extraction + resumable draft storage run in this browser.
   Only bounded text chunks are sent to the authenticated Gemini API.
   No new cloud bucket, API keys, or schema migrations required. */
'use strict';

const BOOK_MAX_BYTES=35*1024*1024;
const BOOK_MAX_PAGES=350;
const BOOK_PART_CHARS=11000;
let bookForm={title:'',teacher:'',school:'',grade:''};
let bookCurrent=null;
let bookSaved=[];
let bookListed=false;
let bookWorking=false;
let bookStop=false;
let bookStatus='';
let bookDataPromise=null;
let bookPdfPromise=null;
let bookLastUserId='';
const bookEsc=val=>E(String(val??''));
const bookUserId=()=>String(state.user?.ownerId||'');
const bookDone=p=>!!p?.chunks?.length&&p.chunks.every(c=>Array.isArray(c.summary?.sections)&&c.summary.sections.length);
const bookCount=p=>p?.chunks?.filter(c=>Array.isArray(c.summary?.sections)&&c.summary.sections.length).length||0;

function bookDatabase(){
  if(!bookDataPromise) bookDataPromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open('waraqa_book_projects_v1',1);
    request.onupgradeneeded=()=>{
      if(!request.result.objectStoreNames.contains('books'))request.result.createObjectStore('books',{keyPath:'id'});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('تعذر فتح قاعدة بيانات الملخصات'));
  }).catch(error=>{bookDataPromise=null;throw error});
  return bookDataPromise;
}
async function bookList(){
  const db=await bookDatabase();
  return new Promise((resolve,reject)=>{
    const request=db.transaction('books','readonly').objectStore('books').getAll();
    request.onsuccess=()=>resolve((request.result||[]).filter(x=>x.userId===bookUserId()).sort((a,b)=>b.updatedAt-a.updatedAt));
    request.onerror=()=>reject(request.error);
  });
}
async function bookStore(project){
  project.updatedAt=Date.now();
  const db=await bookDatabase();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('books','readwrite');
    transaction.objectStore('books').put(project);
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error);
  });
}
async function bookDelete(id){
  const db=await bookDatabase();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('books','readwrite');
    transaction.objectStore('books').delete(id);
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error);
  });
}
function bookRefreshSaved(){
  return bookList().then(items=>{bookSaved=items;return items});
}
function bookEnsureList(){
  if(bookListed||!bookUserId())return;
  bookListed=true;
  bookRefreshSaved().then(()=>{
    if(state.page==='book')render();
  }).catch(()=>{
    bookStatus='تعذر حفظ الملخصات على هذا المتصفح. جرّب متصفح Chrome العادي، وليس وضع التصفح الخاص.';
    if(state.page==='book')render();
  });
}
function bookMessage(message){
  bookStatus=String(message);
  const el=document.querySelector('#book-status');
  if(el)el.textContent=bookStatus;
}
function bookLoadExternal(url,callback){
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const timeout=setTimeout(()=>{script.remove();reject(new Error('تعذر تحميل قارئ PDF. جرّب تحديث الصفحة أو شبكة أخرى.'))},25000);
    script.src=url;script.async=true;
    script.onload=()=>{clearTimeout(timeout);callback()?resolve():reject(new Error('مكتبة PDF لم تبدأ بشكل صحيح.'))};
    script.onerror=()=>{clearTimeout(timeout);reject(new Error('تعذر تحميل مكتبة PDF من شبكة الإنترنت.'))};
    document.head.appendChild(script);
  });
}
async function bookPdfLibrary(){
  if(window.pdfjsLib)return window.pdfjsLib;
  if(!bookPdfPromise)bookPdfPromise=bookLoadExternal(
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    ()=>!!window.pdfjsLib
  ).then(()=>{
    window.pdfjsLib.GlobalWorkerOptions.workerSrc=
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    return window.pdfjsLib;
  }).catch(error=>{bookPdfPromise=null;throw error});
  return bookPdfPromise;
}
function bookPageText(content){
  return (content.items||[]).map(item=>typeof item.str==='string'?
    item.str+(item.hasEOL?'\n':' '):'').join('').replace(/[ \t]+\n/g,'\n').trim();
}
async function bookOcrPage(page,worker){
  const viewport=page.getViewport({scale:1.65});
  const canvas=document.createElement('canvas');
  const scale=Math.min(1,2100/Math.max(viewport.width,viewport.height));
  canvas.width=Math.max(1,Math.round(viewport.width*scale));
  canvas.height=Math.max(1,Math.round(viewport.height*scale));
  const context=canvas.getContext('2d',{willReadFrequently:true});
  try{
    await page.render({canvasContext:context,viewport:page.getViewport({scale:1.65*scale})}).promise;
    const data=await worker.recognize(canvas);
    return String(data?.data?.text||'').trim();
  }finally{canvas.width=0;canvas.height=0}
}
function bookMakeParts(pages){
  const pieces=[];
  for(const page of pages){
    let leftover=page.text.trim();
    while(leftover){
      let size=Math.min(BOOK_PART_CHARS-95,leftover.length);
      if(leftover.length>size){
        const soft=leftover.lastIndexOf('\n',size);
        const word=leftover.lastIndexOf(' ',size);
        const breakpoint=soft>size*.55?soft:(word>size*.6?word:-1);
        if(breakpoint>0)size=breakpoint;
      }
      pieces.push({page:page.number,text:leftover.slice(0,size).trim()});
      leftover=leftover.slice(size).trimStart();
    }
  }
  const chunks=[];let collected=[],length=0;
  const flush=()=>{
    if(!collected.length)return;
    chunks.push({
      index:chunks.length,startPage:collected[0].page,endPage:collected[collected.length-1].page,
      text:collected.map(x=>'[صفحة '+x.page+']\n'+x.text).join('\n\n'),summary:null
    });
    collected=[];length=0;
  };
  for(const piece of pieces){
    const add=piece.text.length+45;
    if(collected.length&&length+add>BOOK_PART_CHARS)flush();
    collected.push(piece);length+=add;
  }
  flush();
  return chunks;
}
function bookSyncForm(){
  for(const field of ['title','teacher','school','grade']){
    const element=document.querySelector('[data-book-field="'+field+'"]');
    if(element)bookForm[field]=element.value.trim().slice(0,140);
  }
}
function bookSummaryHTML(){
  const activeUser=bookUserId();
  if(bookLastUserId!==activeUser){
    bookLastUserId=activeUser;
    bookCurrent=null;bookSaved=[];bookListed=false;bookStop=true;bookStatus='';
    bookForm={title:'',teacher:'',school:'',grade:''};
  }
  bookEnsureList();
  const user=state.user||{};
  const p=bookCurrent;
  if(!bookForm.teacher)bookForm.teacher=p?.teacher||user.name||'';
  if(!bookForm.school)bookForm.school=p?.school||state.draft?.school||'';
  if(!bookForm.grade)bookForm.grade=p?.grade||state.draft?.grade||'';
  if(!bookForm.title)bookForm.title=p?.title||'';
  const done=bookCount(p),total=p?.chunks?.length||0;
  const percent=total?Math.round(100*done/total):0;
  const ready=p&&bookDone(p);
  const savedList=bookSaved.slice(0,25).map(item=>
    '<div class="book-save-item"><div><strong>'+bookEsc(item.title)+'</strong><small>'+
    item.pageCount+' صفحة · '+bookCount(item)+' / '+item.chunks.length+' أجزاء مكتملة</small></div>'+
    '<div class="toolbar"><button class="btn btn-outline btn-sm" data-action="book-open" data-id="'+bookEsc(item.id)+'">فتح</button>'+
    '<button class="btn btn-danger btn-sm" data-action="book-remove" data-id="'+bookEsc(item.id)+'">حذف</button></div></div>'
  ).join('');
  const chapterHtml=p?bookSummaryPartsHTML(p):'';
  return pageHeading('أدوات المعلم','📚 تلخيص كتاب PDF كامل',
    'ارفع الكتاب، راجع عدد الأجزاء، ثم لخّص كل أجزائه بدون إسقاط صفحات مقروءة. الملخص النهائي باسم المعلم.')+
    '<div class="book-layout"><section class="form-card"><h3>بيانات ملخص الكتاب</h3>'+
    '<div class="grid-2"><div class="form-field"><label>اسم الكتاب</label><input class="field" data-book-field="title" maxlength="140" value="'+bookEsc(bookForm.title)+'" placeholder="مثل: كتاب الدراسات الاجتماعية"/></div>'+
    '<div class="form-field"><label>اسم المعلم على الغلاف *</label><input class="field" data-book-field="teacher" maxlength="140" value="'+bookEsc(bookForm.teacher)+'"/></div>'+
    '<div class="form-field"><label>اسم المدرسة (اختياري)</label><input class="field" data-book-field="school" maxlength="140" value="'+bookEsc(bookForm.school)+'"/></div>'+
    '<div class="form-field"><label>الصف الدراسي</label><input class="field" data-book-field="grade" maxlength="90" value="'+bookEsc(bookForm.grade)+'"/></div></div>'+
    '<div class="form-field spaced"><label for="book-file">ملف الكتاب PDF</label>'+
    '<input class="field" id="book-file" type="file" accept=".pdf,application/pdf" '+(bookWorking?'disabled':'')+'/>'+
    '<p class="mini-note">حتى 35 ميجابايت و350 صفحة. استخراج النص يتم داخل المتصفح. لا نرفع ملف PDF نفسه إلى الخادم؛ نرسل النص المستخرج على أجزاء إلى Gemini للتلخيص.</p></div>'+
    '<label class="book-check"><input id="book-ocr" type="checkbox" '+(bookWorking?'disabled':'')+'> الكتاب مصوّر (OCR عربي وإنجليزي) — أبطأ وقد يحتاج وقتًا طويلًا</label>'+
    '<div class="toolbar spaced">'+
    '<button class="btn btn-primary" data-action="book-read" '+(bookWorking?'disabled':'')+'>📖 قراءة ملف PDF وتجهيزه</button>'+
    (p?'<button class="btn btn-primary" data-action="book-run" '+(bookWorking||ready||!state.aiAvailable?'disabled':'')+'>✨ '+(done?'استكمال':'بدء')+' تلخيص الكتاب</button>':'')+
    (bookWorking?'<button class="btn btn-outline" data-action="book-stop">⏸ إيقاف بعد الجزء الحالي</button>':'')+
    (ready?'<button class="btn btn-outline" data-action="book-print">🖨️ طباعة / حفظ PDF باسم المعلم</button>':'')+
    '</div><p role="status" aria-live="polite" id="book-status" class="book-status">'+bookEsc(bookStatus||'ابدأ باختيار ملف الكتاب ثم اقرأه.')+'</p>'+
    (p?'<div class="book-progress" role="progressbar" aria-valuenow="'+percent+'" aria-valuemin="0" aria-valuemax="100" aria-label="تقدم تلخيص الكتاب"><span style="width:'+percent+'%"></span></div>'+
      '<p class="mini-note"><strong>'+done+' من '+total+' أجزاء</strong> • '+percent+'% • عدد صفحات الملف: '+p.pageCount+
      ' • '+(ready?'✅ الملخص كامل وجاهز للطباعة':'الملخص جزئي حتى يكتمل كل جزء')+'</p>':'')+
    '<p class="mini-note">كل جزء يستخدم عملية واحدة من حصة الذكاء الاصطناعي الخاصة بالمعلم (الأساسية والتجريبية: 3 عمليات يوميًا). يمكن استكمال الكتاب بعد تجدد الحصة. لا يوجد اشتراك جديد لجوجل ولا حد إضافي مدفوع من هذه الميزة.</p>'+
    '<p class="mini-note">الملخصات والنص المستخرج تحفظ على <b>نفس المتصفح والجهاز</b> للمتابعة، وليست مخزنة في حساب سحابي. احتفظ بنسخة PDF النهائية بنفسك. راجع صحة الملخص قبل توزيعه، وراجع الجداول والرسومات والخرائط لأن استخراج النص وحده قد لا يشرح تفاصيلها كاملة.</p></section>'+
    '<aside class="form-card"><h3>📂 كتبي المحفوظة على الجهاز</h3>'+
    (savedList||'<p class="mini-note">لم تحفظ كتبًا هنا بعد.</p>')+'</aside></div>'+
    (p?'<section class="form-card spaced"><h3>معاينة الملخص '+(ready?'الكامل':'الجزئي')+'</h3>'+
      (ready?'<p class="notice">✅ تم تلخيص جميع الأجزاء المستخرجة من ملف الكتاب. راجع دقة المحتوى قبل الاستخدام.</p>':
        '<p class="notice blue">⏳ هذه نسخة غير مكتملة، ولا يمكن طباعتها على أنها ملخص الكتاب الكامل بعد.</p>')+
      chapterHtml+'</section>':'');
}
function bookSummaryPartsHTML(project){
  const completed=project.chunks.filter(chunk=>Array.isArray(chunk.summary?.sections));
  if(!completed.length)return '<p class="mini-note">الملخص هيظهر هنا جزءًا بجزء بعد بدء التلخيص.</p>';
  return completed.map((chunk,i)=>'<section class="book-result-part"><h4>الصفحات '+chunk.startPage+'–'+chunk.endPage+'</h4>'+
    chunk.summary.sections.map(section=>
      '<h5>'+bookEsc(section.heading)+'</h5>'+
      '<p>'+bookEsc(section.explanation).replace(/\n/g,'<br>')+'</p>'+
      (section.keyPoints?.length?'<h6>أهم النقاط</h6><ul>'+section.keyPoints.map(x=>'<li>'+bookEsc(x)+'</li>').join('')+'</ul>':'')+
      (section.terms?.length?'<h6>مصطلحات وتعريفات</h6><dl>'+section.terms.map(x=>
        '<dt>'+bookEsc(x.term)+'</dt><dd>'+bookEsc(x.meaning)+'</dd>').join('')+'</dl>':'')+
      (section.review?.length?'<h6>أسئلة للمراجعة</h6><ol>'+section.review.map(x=>
        '<li><strong>'+bookEsc(x.question)+'</strong><p>'+bookEsc(x.answer)+'</p></li>').join('')+'</ol>':'')
    ).join('')+'</section>').join('');
}
function bookPrintMarkup(project){
  const teacher=bookEsc(project.teacher||state.user?.name||'المعلم');
  const school=bookEsc(project.school||'');
  const now=new Date().toLocaleDateString('ar-EG');
  return '<div class="book-print-document">'+
    '<section class="book-print-cover"><div class="book-print-brand">▤ ورقة</div>'+
    '<div><div class="book-print-label">ملخص الكتاب الدراسي</div><h1>'+bookEsc(project.title)+'</h1>'+
    '<h2>'+bookEsc(project.grade||'')+'</h2></div>'+
    '<div class="book-print-teacher">إعداد المعلم<br><strong>'+teacher+'</strong>'+
    (school?'<div>'+school+'</div>':'')+'</div>'+
    '<small>ملخص من '+project.pageCount+' صفحة من الكتاب الأصلي • '+now+'</small></section>'+
    '<section class="book-print-intro"><h2>محتويات الملخص</h2><p>أُعِد هذا الملخص من نص جميع أجزاء الكتاب المقروءة. أرقام الصفحات تشير إلى ملف PDF الأصلي.</p>'+
    '<ol>'+project.chunks.map(c=>'<li>الصفحات '+c.startPage+'–'+c.endPage+' — '+
      bookEsc(c.summary.sections.map(x=>x.heading).join('، '))+'</li>').join('')+'</ol></section>'+
    bookSummaryPartsHTML(project)+'</div>';
}

async function bookReadFile(){
  if(bookWorking)return;
  const file=document.querySelector('#book-file')?.files?.[0];
  const ocr=!!document.querySelector('#book-ocr')?.checked;
  if(!file)return toast('اختار ملف الكتاب PDF أولاً');
  if(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf')return toast('الملف لازم يكون PDF');
  if(file.size>BOOK_MAX_BYTES)return toast('حجم الملف أكبر من 35 ميجابايت. قسّم الكتاب إلى ملفات أصغر.');
  bookSyncForm();
  if(!bookForm.teacher)return toast('اكتب اسم المعلم الذي سيظهر على الغلاف.');
  if(!bookForm.title)bookForm.title=file.name.replace(/\.pdf$/i,'').slice(0,140);
  bookWorking=true;bookStop=false;bookMessage('جارٍ تجهيز ملف PDF...');render();
  let pdf,ocrWorker;
  try{
    const buffer=await file.arrayBuffer();
    if(!crypto.subtle?.digest)throw new Error('قراءة الملف تتطلب اتصال HTTPS آمن.');
    const bytes=new Uint8Array(buffer);
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))).map(x=>x.toString(16).padStart(2,'0')).join('');
    const id=bookUserId()+':'+hash;
    const existing=bookSaved.find(item=>item.id===id);
    if(existing){
      bookCurrent=existing;
      bookForm={title:existing.title,teacher:existing.teacher,school:existing.school,grade:existing.grade};
      bookMessage('الكتاب ده اتحفظ قبل كده. فتحنا آخر تقدم ليك؛ تقدر تكمل من مكان ما وقفت.');
      return;
    }
    const pdfjs=await bookPdfLibrary();
    const task=pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false});
    pdf=await task.promise;
    if(pdf.numPages>BOOK_MAX_PAGES)throw new Error('الكتاب '+pdf.numPages+' صفحة. الحد الحالي 350 صفحة؛ قسّمه إلى أجزاء PDF أصغر.');
    const pages=[],unreadable=[];
    for(let number=1;number<=pdf.numPages;number++){
      if(bookStop)throw new Error('تم إيقاف القراءة قبل الانتهاء. اختر الملف مرة أخرى لاستكمال القراءة.');
      bookMessage('جارٍ قراءة صفحة '+number+' من '+pdf.numPages+(ocr?' (مع OCR عند الحاجة)':'')+'...');
      const page=await pdf.getPage(number);
      const extracted=bookPageText(await page.getTextContent());
      let text=extracted;
      if(text.length<12&&ocr){
        if(!ocrWorker){
          const tesseract=await ensureOcrLibrary();
          ocrWorker=await tesseract.createWorker(['ara','eng'],1);
        }
        text=await bookOcrPage(page,ocrWorker);
      }
      if(text.trim().length<12)unreadable.push(number);
      else pages.push({number,text});
      page.cleanup();
    }
    if(unreadable.length)throw new Error('لم نتمكن من قراءة الصفحات: '+unreadable.slice(0,18).join('، ')+
      (unreadable.length>18?' وغيرها':'')+
      '. '+(ocr?'راجع جودة المسح الضوئي؛ لن ندّعي تلخيص كتاب لم نقرأ كل صفحاته.':'فعّل خيار OCR ثم اقرأ الملف مرة أخرى.'));
    const chunks=bookMakeParts(pages);
    if(!chunks.length)throw new Error('ملف PDF لا يحتوي على نص قابل للتلخيص.');
    bookCurrent={
      id,userId:bookUserId(),fileName:file.name,title:bookForm.title,teacher:bookForm.teacher,
      school:bookForm.school,grade:bookForm.grade,pageCount:pdf.numPages,chunks,
      createdAt:Date.now(),updatedAt:Date.now()
    };
    await bookStore(bookCurrent);
    await bookRefreshSaved();
    bookMessage('✅ قرأنا '+pdf.numPages+' صفحة وجهزنا '+chunks.length+
      ' جزءًا. اضغط «بدء تلخيص الكتاب». كل جزء عملية ذكاء اصطناعي.');
  }catch(error){bookMessage('⚠️ '+(error?.message||'تعذر قراءة الكتاب'))}
  finally{
    try{await ocrWorker?.terminate()}catch{}
    try{await pdf?.destroy()}catch{}
    bookWorking=false;render();
  }
}
async function bookRun(){
  if(bookWorking||!bookCurrent||bookDone(bookCurrent))return;
  if(!state.aiAvailable)return toast('التلخيص يحتاج تفعيل Gemini على الموقع.');
  bookSyncForm();
  if(!bookForm.teacher)return toast('أدخل اسم المعلم أولًا');
  bookCurrent.title=bookForm.title||bookCurrent.title;
  bookCurrent.teacher=bookForm.teacher;
  bookCurrent.school=bookForm.school;
  bookCurrent.grade=bookForm.grade;
  try{await bookStore(bookCurrent)}catch(error){return toast('تعذر حفظ تقدم الكتاب: '+error.message)}
  bookWorking=true;bookStop=false;render();
  try{
    for(const chunk of bookCurrent.chunks){
      if(bookStop)break;
      if(Array.isArray(chunk.summary?.sections)&&chunk.summary.sections.length)continue;
      bookMessage('جارٍ تلخيص الصفحات '+chunk.startPage+'–'+chunk.endPage+' • الجزء '+(chunk.index+1)+' من '+bookCurrent.chunks.length+'...');
      const response=await fetch('/api/summarize-book',{
        method:'POST',headers:await aiHeaders(),
        body:JSON.stringify({
          title:bookCurrent.title,grade:bookCurrent.grade,startPage:chunk.startPage,
          endPage:chunk.endPage,text:chunk.text
        })
      });
      let data;
      try{data=await response.json()}catch{throw new Error('استجابة التلخيص غير صالحة. جرّب متابعة الجزء لاحقًا.')}
      if(!response.ok)throw new Error(data.error||'تعذر تلخيص هذا الجزء.');
      if(!Array.isArray(data.sections)||!data.sections.length)throw new Error('لم نحصل على ملخص صالح لهذا الجزء.');
      chunk.summary={sections:data.sections};
      // Save before moving to the next paid/quota-counted Gemini call.
      await bookStore(bookCurrent);
      const number=bookCount(bookCurrent);
      bookMessage('✅ اكتمل '+number+' من '+bookCurrent.chunks.length+' جزء • تم حفظ التقدم تلقائيًا.');
      render();
    }
    if(bookDone(bookCurrent))bookMessage('✅ اكتمل ملخص كل صفحات الكتاب. راجع المحتوى ثم اطبعه باسم المعلم.');
    else if(bookStop)bookMessage('⏸ تم حفظ ما اكتمل. تقدر تستكمل لاحقًا من نفس الجهاز.');
  }catch(error){
    bookMessage('⚠️ '+(error?.message||'حدث خطأ')+' — تم حفظ الأجزاء المكتملة. اضغط «استكمال تلخيص الكتاب» لاحقًا.');
  }finally{
    bookWorking=false;
    await bookRefreshSaved().catch(()=>{});
    render();
  }
}
async function bookOpen(id){
  if(bookWorking)return;
  const found=bookSaved.find(x=>x.id===id);
  if(!found||found.userId!==bookUserId())return toast('الكتاب غير موجود على هذا الجهاز.');
  bookCurrent=found;
  bookForm={title:found.title,teacher:found.teacher,school:found.school,grade:found.grade};
  bookStatus=bookDone(found)?'✅ الملخص كامل وجاهز للطباعة.':'تقدر تستكمل الأجزاء اللي لسه ما اتلخّصتش.';
  render();
}
async function bookRemove(id){
  if(bookWorking)return;
  const found=bookSaved.find(x=>x.id===id);
  if(!found||found.userId!==bookUserId())return;
  if(!confirm('تحذف النص المستخرج والملخص المحفوظ لهذا الكتاب من هذا الجهاز؟'))return;
  await bookDelete(id);
  if(bookCurrent?.id===id){bookCurrent=null;bookStatus='تم حذف الكتاب من هذا الجهاز.'}
  await bookRefreshSaved();render();
}
async function bookSaveFields(){
  bookSyncForm();
  if(!bookCurrent||bookWorking)return;
  for(const name of ['title','teacher','school','grade'])bookCurrent[name]=bookForm[name];
  try{await bookStore(bookCurrent)}catch{toast('تعذر حفظ بيانات الغلاف.')}
}
function bookPrint(){
  if(!bookCurrent||!bookDone(bookCurrent))return toast('لا يمكن طباعة ملخص كامل قبل انتهاء جميع الأجزاء.');
  bookSyncForm();
  if(!bookForm.teacher)return toast('أدخل اسم المعلم الذي سيظهر على الغلاف.');
  for(const name of ['title','teacher','school','grade'])bookCurrent[name]=bookForm[name];
  bookStore(bookCurrent).catch(()=>{});
  const root=document.querySelector('#print-root');
  if(!root)return toast('تعذر العثور على منطقة الطباعة.');
  root.innerHTML=bookPrintMarkup(bookCurrent);
  window.print();
}
const bookPreviousAct=act;
act=async function(action,button){
  if(action==='book-read')return bookReadFile();
  if(action==='book-run')return bookRun();
  if(action==='book-stop'){bookStop=true;return bookMessage('⏸ هنوقف بعد الانتهاء من الجزء الحالي، مع حفظ التقدم.')}
  if(action==='book-open')return bookOpen(button.dataset.id);
  if(action==='book-remove')return bookRemove(button.dataset.id);
  if(action==='book-print')return bookPrint();
  if((action==='go'&&state.page==='book')||action==='logout')bookStop=true;
  return bookPreviousAct(action,button);
};
document.addEventListener('change',event=>{
  if(event.target?.dataset?.bookField)bookSaveFields();
});
const bookStyles=document.createElement('style');
bookStyles.textContent=`
.book-layout{display:grid;grid-template-columns:minmax(0,2fr) minmax(240px,1fr);gap:18px;align-items:start}
.book-layout .form-card h3{margin:0 0 16px}.book-layout .toolbar{flex-wrap:wrap}
.book-check{display:flex;align-items:center;gap:9px;font-size:13px;margin:13px 0;line-height:1.6}
.book-check input{width:17px;height:17px}.book-status{padding:11px 13px;background:#f1f0ff;border-radius:10px;color:#342887;line-height:1.8;min-height:42px}
.book-progress{height:10px;border-radius:999px;overflow:hidden;background:#e9e9fa;margin:12px 0}
.book-progress span{display:block;height:100%;background:#6557e9;transition:width .2s}
.book-save-item{padding:11px 0;border-bottom:1px solid #eef0f6;display:flex;align-items:center;justify-content:space-between;gap:9px;flex-wrap:wrap}
.book-save-item strong{display:block;font-size:13px;overflow-wrap:anywhere}.book-save-item small{display:block;color:#7d8499;margin-top:4px}
.book-result-part{margin:22px 0;padding:18px 22px;border:1px solid #e6eaf4;border-radius:14px;background:white;line-height:1.9}
.book-result-part h4{color:#6557e9;font-size:14px;border-bottom:1px solid #eee;padding-bottom:8px}
.book-result-part h5{font-size:18px;margin:18px 0 8px}
.book-result-part h6{font-size:14px;margin:13px 0 5px}.book-result-part p{white-space:normal}
.book-result-part li{margin:7px 0}.book-result-part dt{font-weight:800}.book-result-part dd{margin:1px 0 11px 0}
.book-print-document{font-family:'Tajawal',Tahoma,Arial,sans-serif;direction:rtl;color:#171b32;line-height:1.9}
.book-print-cover{min-height:240mm;display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center;padding:30mm 10mm 20mm;border:2px solid #dedaf7}
.book-print-brand{font-size:24px;font-weight:800;color:#6557e9}
.book-print-label{font-size:19px}.book-print-cover h1{font-size:34px;line-height:1.5}
.book-print-cover h2{font-size:21px}.book-print-teacher{font-size:18px}
.book-print-teacher strong{font-size:27px}.book-print-intro{padding:10mm 0}
@media(max-width:900px){.book-layout{grid-template-columns:1fr}}
@media(max-width:620px){.book-layout .toolbar .btn{white-space:normal}.book-save-item .toolbar{justify-content:flex-start}}
@media print{
  .book-print-document{color:#111;line-height:1.75;font-size:12pt}
  .book-print-cover{page-break-after:always;break-after:page}
  .book-print-intro{page-break-after:always;break-after:page}
  .book-print-document .book-result-part{border:none;border-radius:0;padding:0;margin:11mm 0}
  .book-print-document .book-result-part h4{break-after:avoid;color:#000;font-size:12pt}
  .book-print-document .book-result-part h5{break-after:avoid;font-size:15pt}
  .book-print-document .book-result-part li{break-inside:avoid}
}`;
document.head.appendChild(bookStyles);
