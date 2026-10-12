// Cloudflare Pages Functions bridge for Waraqa's server-side API.
// The entry point is /api/:name, not exposed as a public static asset.
// Configure Pages compatibility date >= 2026-08-04 for Node APIs, Buffer,
// node:crypto and process.env binding support. Secrets belong in Pages
// Settings > Variables and Secrets, NEVER GitHub or public JS.
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

const routes=Object.freeze({
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

export async function onRequest(context){
  const key=String(context.params?.name||'');
  if(!Object.hasOwn(routes,key))
    return Response.json({error:'المسار غير متاح'}, {status:404,headers:{'Cache-Control':'no-store'}});
  try{
    // Bindings are populated into process.env by the current Cloudflare
    // Node-compat runtime; reject use of an unconfigured environment.
    // /api/config intentionally works without secrets, to diagnose setup.
    return await routes[key].fetch(context.request);
  }catch(error){
    console.error('Waraqa Cloudflare API error:',key,error?.name||'error');
    return Response.json({error:'تعذّر إكمال الطلب حالياً'},
      {status:500,headers:{'Cache-Control':'no-store'}});
  }
}
