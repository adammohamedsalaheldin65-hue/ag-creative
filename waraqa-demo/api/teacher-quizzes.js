import {randomBytes} from 'node:crypto';
import {authenticate,studentPortalEnabled} from '../lib/auth.js';
import {supabaseRest} from '../lib/billing.js';
import {result,problem,fail} from '../lib/gemini.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normalize=s=>String(s??'').normalize('NFKC').trim().replace(/\s+/g,' ').replace(/[.،؛:!؟]+$/g,'').toLowerCase();
const unsafeChoice=/كل\s+ما\s+سبق|جميع\s+ما\s+سبق|all\s+of\s+the\s+above|none\s+of\s+the\s+above|(?:الاختيار|الخيار)\s+(?:الأول|الثاني|الثالث|الرابع)/i;
function correctChoice(q,options){
 const answer=normalize(q.answer);
 const direct=options.findIndex(o=>normalize(o)===answer);
 if(direct>=0)return direct;
 const match=answer.match(/^(?:(?:الإجابة(?: الصحيحة)?|الاختيار(?: الصحيح)?)\s*[:：-]?\s*)?([أابجدa-d])(?:[).]\s*(.*))?$/i);
 if(!match)return -1;
 const n=/^[a-d]$/i.test(match[1])?match[1].toLowerCase().charCodeAt(0)-97:
   ['أ','ب','ج','د'].indexOf(match[1]==='ا'?'أ':match[1]);
 if(n<0||n>=options.length)return -1;
 if(match[2]&&normalize(match[2])!==normalize(options[n]))return -1;
 return n;
}
export function safeQuizQuestions(source){
 const questions=Array.isArray(source)?source:[];
 const eligible=questions.flatMap(q=>{
   if(!q||q.visual||q.imageIndex!=null||q.image_index!=null)return [];
   const text=String(q.text||'').trim().slice(0,1000);
   const options=Array.isArray(q.options)?q.options.map(x=>String(x).trim().slice(0,240)).filter(Boolean):[];
   if(text.length<5||options.length<2||options.length>4)return [];
   if(new Set(options.map(normalize)).size!==options.length)return [];
   if(unsafeChoice.test([text,q.answer,...options].join(' ')))return [];
   const correctIndex=correctChoice(q,options);
   if(correctIndex<0)return [];
   return [{text,options,correctIndex}];
 });
 return {questions:eligible.slice(0,30).map((q,i)=>({...q,id:'q'+(i+1)})),skipped:questions.length-Math.min(eligible.length,30)};
}
function cleanQuiz(q){
 return {
  id:q.id,title:q.title,subject:q.subject,grade:q.grade,
  code:q.access_code,enabled:q.enabled,
  expiresAt:q.expires_at,createdAt:q.created_at,
  count:Array.isArray(q.questions)?q.questions.length:0
 };
}
export default {
 async fetch(request){
  try{
   if(!studentPortalEnabled())return problem('بوابة الطلاب لم تُفعّل بعد. يلزم تنفيذ SQL ثم إعداد Vercel.',503);
   const auth=await authenticate(request,{role:'teacher'});
   const userId=auth.user.id;
   if(request.method==='GET'){
     const quizzes=await supabaseRest('waraqa_quizzes?select=id,title,subject,grade,access_code,enabled,expires_at,created_at,questions&teacher_id=eq.'+
       encodeURIComponent(userId)+'&order=created_at.desc&limit=60');
     const id=new URL(request.url).searchParams.get('id');
     if(id){
       if(!uuid.test(id))return problem('معرّف الامتحان غير صحيح');
       const quiz=(quizzes||[]).find(x=>x.id===id);
       if(!quiz)return problem('الامتحان غير موجود في حسابك',404);
       const rows=await supabaseRest('waraqa_quiz_attempts?select=student_id,correct_count,question_count,score_percent,submitted_at&quiz_id=eq.'+
         encodeURIComponent(id)+'&order=submitted_at.desc&limit=250');
       const studentIds=[...new Set((rows||[]).map(x=>x.student_id))];
       const accounts=studentIds.length?await supabaseRest('waraqa_accounts?select=user_id,display_name&user_id=in.('+
         studentIds.join(',')+')'):[];
       const names=new Map((accounts||[]).map(x=>[x.user_id,x.display_name]));
       return result({quiz:cleanQuiz(quiz),
         attempts:(rows||[]).map(row=>({
           studentName:names.get(row.student_id)||'طالب',
           correctCount:row.correct_count,questionCount:row.question_count,
           scorePercent:Number(row.score_percent),submittedAt:row.submitted_at
         }))
       });
     }
     return result({quizzes:(quizzes||[]).map(cleanQuiz)});
   }
   if(request.method!=='POST')return problem('طريقة الطلب غير مدعومة',405);
   const body=await request.json().catch(()=>({}));
   if(body.action==='publish'){
     const examId=String(body.examId||'');
     if(!uuid.test(examId))return problem('افتح امتحان محفوظ صحيح أولًا');
     // NEVER accept questions from browser or a guessed exam ID.
     const originals=await supabaseRest('exams?select=id,payload&user_id=eq.'+encodeURIComponent(userId)+
       '&id=eq.'+encodeURIComponent(examId)+'&limit=1');
     const original=originals?.[0]?.payload;
     if(!original||original.ownerId!==userId)return problem('الامتحان غير محفوظ في حسابك',404);
     const {questions,skipped}=safeQuizQuestions(original.questions);
     if(!questions.length)return problem('الامتحان لا يحتوي على أسئلة اختيار من متعدد بإجابات واضحة. راجع الأسئلة واحفظها أولًا.');
     const code=randomBytes(6).toString('hex').toUpperCase();
     const added=await supabaseRest('waraqa_quizzes',{
       method:'POST',headers:{Prefer:'return=representation'},
       body:{
         teacher_id:userId,source_exam_id:examId,access_code:code,
         title:String(original.title||'امتحان').slice(0,160),
         subject:String(original.subject||'').slice(0,100),
         grade:String(original.grade||'').slice(0,100),questions
       }
     });
     return result({quiz:cleanQuiz(added?.[0]),skipped},201);
   }
   if(body.action==='toggle'){
     const id=String(body.id||'');
     if(!uuid.test(id)||typeof body.enabled!=='boolean')return problem('بيانات الامتحان غير صحيحة');
     const changed=await supabaseRest('waraqa_quizzes?id=eq.'+encodeURIComponent(id)+'&teacher_id=eq.'+encodeURIComponent(userId),{
       method:'PATCH',headers:{Prefer:'return=representation'},body:{enabled:body.enabled}
     });
     if(!changed?.length)return problem('الامتحان غير موجود',404);
     return result({quiz:cleanQuiz(changed[0])});
   }
   return problem('الإجراء غير معروف');
  }catch(error){return fail(error)}
 }
};
