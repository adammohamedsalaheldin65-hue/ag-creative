/**
 * Waraqa zero-dependency Node.js server for Render Free.
 *
 * Serves only files from the generated public dist/ directory; all Supabase
 * secrets, payment proofs, SQL, and API modules stay server-side.
 * Existing Fetch-standard /api/* handlers remain unchanged.
 *
 * Build: node scripts/build-netlify.mjs
 * Start: node server-render.mjs
 */
import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat,realpath} from 'node:fs/promises';
import {join,resolve,sep,extname} from 'node:path';
import {Readable} from 'node:stream';

import apiConfig from './api/config.js';
import generateExam from './api/generate-exam.js';
import generateStoryboard from './api/generate-storyboard.js';
import paymentAdmin from './api/payment-admin.js';
import paymentProof from './api/payment-proof.js';
import studentQuizzes from './api/student-quizzes.js';
import studentStudy from './api/student-study.js';
import studentTutor from './api/student-tutor.js';
import subscriptionStatus from './api/subscription-status.js';
import summarizeBook from './api/summarize-book.js';
import teacherQuizzes from './api/teacher-quizzes.js';

const publicRoot=resolve('dist');
const handlers=Object.freeze({
  'config':apiConfig,
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
const mimes={
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.ico':'image/x-icon',
  '.webp':'image/webp'
};
const MAX_BODY=24*1024*1024; // Larger AI-image JSON payloads need room.

function errorResponse(res,status,message){
  if(res.headersSent){res.destroy();return;}
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'
  });
  res.end(JSON.stringify({error:message}));
}
async function parseBody(req){
  let size=0;
  const chunks=[];
  for await (const chunk of req){
    size+=chunk.byteLength;
    if(size>MAX_BODY){
      const error=new Error('الملف كبير جدًا. قلّل حجم الصور أو الدرس.');
      error.status=413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,size);
}
async function apiRequest(req,res,name){
  const handler=handlers[name];
  if(!handler)return errorResponse(res,404,'المسار غير موجود');
  if(req.method==='OPTIONS'){
    res.writeHead(405,{'Allow':'GET, POST'});res.end();return;
  }
  if(!['GET','POST','PATCH','DELETE','HEAD'].includes(req.method||''))
    return errorResponse(res,405,'طريقة الطلب غير مدعومة');
  const rawSize=Number(req.headers['content-length']||0);
  if(rawSize>MAX_BODY)return errorResponse(res,413,'حجم الطلب أكبر من المسموح');
  try{
    const requestURL=new URL(req.url||'/', 'http://localhost');
    const options={method:req.method,headers:req.headers};
    if(!['GET','HEAD'].includes(req.method||'')){
      options.body=await parseBody(req);
    }
    const fetchRequest=new Request(requestURL.toString(),options);
    const response=await handler.fetch(fetchRequest);
    if(!(response instanceof Response))throw new Error('API handler returned invalid response');
    const headers={};
    for(const [key,value] of response.headers){
      if(!['connection','transfer-encoding','content-length','keep-alive'].includes(key.toLowerCase()))
        headers[key]=value;
    }
    headers['Cache-Control']='no-store';
    headers['X-Content-Type-Options']='nosniff';
    res.writeHead(response.status,headers);
    if(req.method==='HEAD'||!response.body){res.end();return;}
    const nodeBody=Readable.fromWeb(response.body);
    nodeBody.on('error',()=>res.destroy());
    nodeBody.pipe(res);
  }catch(error){
    if(error?.status===413)return errorResponse(res,413,error.message);
    console.error('Waraqa API request failed:',name,error?.message||'unknown error');
    return errorResponse(res,500,'تعذر إكمال الطلب حاليًا');
  }
}

async function serveStatic(req,res,pathname){
  if(!['GET','HEAD'].includes(req.method||''))
    return errorResponse(res,405,'طريقة الطلب غير مدعومة');
  // Serve only the explicit output of the build script, not the source tree.
  const name=pathname==='/'?'index.html':pathname.slice(1);
  if(!/^[a-zA-Z0-9_.-]+$/.test(name)||name.startsWith('.'))
    return errorResponse(res,404,'الصفحة غير موجودة');
  const file=join(publicRoot,name);
  if(file!==publicRoot&&!file.startsWith(publicRoot+sep))
    return errorResponse(res,404,'الصفحة غير موجودة');
  try{
    const [fileInfo,canonical]=await Promise.all([stat(file),realpath(file)]);
    if(!fileInfo.isFile()||!canonical.startsWith(publicRoot+sep))
      return errorResponse(res,404,'الصفحة غير موجودة');
    res.writeHead(200,{
      'Content-Type':mimes[extname(name).toLowerCase()]||'application/octet-stream',
      'Content-Length':fileInfo.size,
      'Cache-Control':'no-cache',
      'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'strict-origin-when-cross-origin'
    });
    if(req.method==='HEAD'){res.end();return;}
    createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  }catch(error){
    if(error.code==='ENOENT')return errorResponse(res,404,'الصفحة غير موجودة');
    console.error('Waraqa static delivery failed:',error?.code||'unknown');
    return errorResponse(res,500,'تعذر تحميل الصفحة');
  }
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/', 'http://localhost');
    if(url.pathname.startsWith('/api/')){
      const name=url.pathname.slice('/api/'.length);
      return apiRequest(req,res,name);
    }
    return serveStatic(req,res,url.pathname);
  }catch(error){
    console.error('Waraqa invalid request:',error?.message||'unknown');
    return errorResponse(res,400,'طلب غير صالح');
  }
});
server.requestTimeout=120000;
server.headersTimeout=65000;
const port=Number(process.env.PORT||10000);
server.listen(port,'0.0.0.0',()=>console.log('Waraqa web service listening on port',port));
for(const signal of ['SIGTERM','SIGINT']){
  process.once(signal,()=>server.close(()=>process.exit(0)));
}
