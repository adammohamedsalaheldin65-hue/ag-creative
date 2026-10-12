// Netlify Functions v2: one safe routing adapter for Waraqa's existing
// Fetch-style API. This keeps /api/* URLs unchanged for both portals.
import configEndpoint from '../../api/config.js';
import generateExam from '../../api/generate-exam.js';
import generateStoryboard from '../../api/generate-storyboard.js';
import paymentAdmin from '../../api/payment-admin.js';
import paymentProof from '../../api/payment-proof.js';
import studentQuizzes from '../../api/student-quizzes.js';
import studentStudy from '../../api/student-study.js';
import studentTutor from '../../api/student-tutor.js';
import subscriptionStatus from '../../api/subscription-status.js';
import summarizeBook from '../../api/summarize-book.js';
import teacherQuizzes from '../../api/teacher-quizzes.js';

const handlers=Object.freeze({
 'config':configEndpoint,
 'generate-exam':generateExam,
 'generate-storyboard':generateStoryboard,
 'payment-admin':paymentAdmin,
 'payment-proof':paymentProof,
 'student-quizzes':studentQuizzes,
 'student-study':studentStudy,
  'student-tutor':studentTutor,
 'subscription-status':subscriptionStatus,
 'summarize-book':summarizeBook,
 'teacher-quizzes':teacherQuizzes
});

export default async (request)=>{
 const url=new URL(request.url);
 const path=url.pathname;
 const name=path.startsWith('/api/')?path.slice(5):'';
 if(!Object.hasOwn(handlers,name))
  return Response.json({error:'المسار غير متاح'},{status:404,headers:{'Cache-Control':'no-store'}});
 const api=handlers[name];
 try{
  return await api.fetch(request);
 }catch(error){
  console.error('[Waraqa Netlify API] unhandled error in',name,error?.name||'unknown');
  return Response.json({error:'تعذّر إكمال الطلب حالياً'},{status:500,headers:{'Cache-Control':'no-store'}});
 }
};

export const config={path:'/api/:name'};
