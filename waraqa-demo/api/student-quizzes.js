import {authenticate,studentPortalEnabled} from '../lib/auth.js';
import {supabaseRest} from '../lib/billing.js';
import {result,problem,fail} from '../lib/gemini.js';

const validCode=/^[A-F0-9]{12}$/;
function publicQuiz(q){
 return {
  id:q.id,title:q.title,subject:q.subject,grade:q.grade,
  questionCount:q.questions.length,
  questions:q.questions.map(({id,text,options})=>({id,text,options}))
 };
}
function attemptPublic(a){
 return a?{
  correctCount:a.correct_count,questionCount:a.question_count,
  scorePercent:Number(a.score_percent),submittedAt:a.submitted_at
 }:null;
}
export default{
 async fetch(request){
  try{
   if(!studentPortalEnabled())return problem('بوابة الطلاب لم تُفعّل بعد',503);
   const auth=await authenticate(request,{role:'student',requireAccess:false});
   const studentId=auth.user.id;
   if(request.method==='GET'){
    const url=new URL(request.url);
    if(url.searchParams.get('history')==='1'){
      const rows=await supabaseRest('waraqa_quiz_attempts?select=quiz_id,correct_count,question_count,score_percent,submitted_at&student_id=eq.'+
        encodeURIComponent(studentId)+'&order=submitted_at.desc&limit=50');
      const ids=[...new Set((rows||[]).map(x=>x.quiz_id))];
      const quizInfo=ids.length?await supabaseRest('waraqa_quizzes?select=id,title,subject,grade&id=in.('+
         ids.join(',')+')'):[];
      const meta=new Map((quizInfo||[]).map(q=>[q.id,q]));
      return result({attempts:(rows||[]).map(a=>({
       ...attemptPublic(a),title:meta.get(a.quiz_id)?.title||'امتحان',
       subject:meta.get(a.quiz_id)?.subject||'',grade:meta.get(a.quiz_id)?.grade||''
      }))});
    }
    const code=String(url.searchParams.get('code')||'').trim().toUpperCase();
    if(!validCode.test(code))return problem('أدخل كود الامتحان المكوّن من 12 حرفًا ورقمًا');
    const list=await supabaseRest('waraqa_quizzes?select=id,title,subject,grade,questions,enabled,expires_at&access_code=eq.'+
      encodeURIComponent(code)+'&limit=1');
    const q=list?.[0];
    if(!q||!q.enabled||Date.parse(q.expires_at)<=Date.now())return problem('كود الامتحان غير متاح أو انتهت صلاحيته',404);
    const tried=await supabaseRest('waraqa_quiz_attempts?select=correct_count,question_count,score_percent,submitted_at&quiz_id=eq.'+
      encodeURIComponent(q.id)+'&student_id=eq.'+encodeURIComponent(studentId)+'&limit=1');
    return result({quiz:publicQuiz(q),attempt:attemptPublic(tried?.[0])});
   }
   if(request.method==='POST'){
    const d=await request.json().catch(()=>({}));
    const code=String(d.code||'').trim().toUpperCase();
    if(!validCode.test(code))return problem('كود الامتحان غير صحيح');
    const quizRows=await supabaseRest('waraqa_quizzes?select=id,questions,enabled,expires_at&access_code=eq.'+
       encodeURIComponent(code)+'&limit=1');
    const q=quizRows?.[0];
    if(!q||!q.enabled||Date.parse(q.expires_at)<=Date.now())return problem('انتهت صلاحية الامتحان',404);
    const questions=Array.isArray(q.questions)?q.questions:[];
    if(!questions.length||questions.length>30)return problem('الامتحان غير صالح حاليًا',503);
    if(!d.responses||typeof d.responses!=='object'||Array.isArray(d.responses)||
       Object.keys(d.responses).length>30)return problem('الإجابات غير صالحة');
    const allowedKeys=new Set(questions.map(x=>x.id));
    if(Object.keys(d.responses).some(k=>!allowedKeys.has(k)))return problem('تم إرسال إجابة لسؤال غير موجود');
    const responses={};
    let right=0;
    for(const question of questions){
      const answer=d.responses[question.id];
      // Unanswered questions count as incorrect; never accept answer text/keys from client.
      if(answer!==undefined&&answer!==null&&
        (!Number.isInteger(answer)||answer<0||answer>=question.options.length))
        return problem('اختيار غير صحيح');
      responses[question.id]=answer??null;
      if(answer===question.correctIndex)right++;
    }
    const percent=Number((100*right/questions.length).toFixed(2));
    const existing=await supabaseRest('waraqa_quiz_attempts?select=id&quiz_id=eq.'+
      encodeURIComponent(q.id)+'&student_id=eq.'+encodeURIComponent(studentId)+'&limit=1');
    if(existing?.length)return problem('أرسلت إجابات هذا الامتحان بالفعل. يمكنك مشاهدة نتيجتك.',409);
    // Unique (quiz_id, student_id) prevents racing multiple submissions.
    let saved;
    try{
     saved=await supabaseRest('waraqa_quiz_attempts',{
       method:'POST',headers:{Prefer:'return=representation'},
       body:{
         quiz_id:q.id,student_id:studentId,responses,
         correct_count:right,question_count:questions.length,score_percent:percent
       }
     });
    }catch(error){
     if(error?.detail?.includes('23505'))return problem('أرسلت إجابات هذا الامتحان بالفعل',409);
     throw error;
    }
    return result({attempt:attemptPublic(saved?.[0])},201);
   }
   return problem('طريقة الطلب غير مدعومة',405);
  }catch(error){return fail(error)}
 }
};
