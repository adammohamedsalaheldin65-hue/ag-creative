import {timingSafeEqual} from 'node:crypto';
import {billingSettings,supabaseRest,signedProof} from '../lib/billing.js';
import {result,problem,fail} from '../lib/gemini.js';

// Internal API; all methods require a SERVER-side admin token configured in Vercel.
// A payment image can never grant itself access.
function validAdmin(request){
 const secret=String(process.env.SUBSCRIPTION_ADMIN_TOKEN||'');
 const supplied=String(request.headers.get('x-admin-key')||'');
 if(secret.length<32||supplied.length!==secret.length)return false;
 return timingSafeEqual(Buffer.from(supplied),Buffer.from(secret));
}
export default {
 async fetch(request){
  try{
   if(!billingSettings().enabled)return problem('الاشتراكات غير مفعلة',503);
   if(!validAdmin(request))return problem('غير مصرح بالدخول',401);
   if(request.method==='GET'){
    const payments=await supabaseRest('subscription_payments?select=id,user_id,plan,amount_egp,status,reference_note,ai_result,created_at,receipt_path,admin_note,resolved_at&order=created_at.desc&limit=80');
    const mapped=await Promise.all((payments||[]).map(async p=>({
      id:p.id,userId:p.user_id,plan:p.plan,amountEGP:p.amount_egp,status:p.status,referenceNote:p.reference_note,
      ai:p.ai_result,createdAt:p.created_at,resolvedAt:p.resolved_at,adminNote:p.admin_note,
      proofUrl:p.status==='pending'?await signedProof(p.receipt_path):null
    })));
    return result({payments:mapped});
   }
   if(request.method==='POST'){
    const body=await request.json().catch(()=>null);
    const id=String(body?.paymentId||'');
    const decision=body?.decision;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      return problem('معرّف الطلب غير صحيح',400);
    if(!['approve','reject'].includes(decision))return problem('اختار موافقة أو رفض',400);
    if(decision==='approve'&&body.confirmedInBank!==true)
      return problem('لا يمكن الموافقة قبل التأكد من وصول التحويل في تطبيق إنستا باي/كشف الحساب الحقيقي',400);
    const verifiedRef=String(body?.verifiedBankReference||'').trim();
    if(decision==='approve'&&(verifiedRef.length<6||verifiedRef.length>140))
      return problem('أدخل رقم المعاملة الفعلي من سجل الحساب لاستبعاد إعادة استخدام نفس التحويل',400);
    const out=await supabaseRest('rpc/waraqa_resolve_payment',{
      method:'POST',body:{
        p_payment_id:id,
        p_approve:decision==='approve',
        p_admin_note:String(body.adminNote||'').trim().slice(0,400),
        p_verified_ref:decision==='approve'?verifiedRef:''
      }
    });
    return result({ok:true,decision,paidUntil:Array.isArray(out)?out[0]?.paid_through:null});
   }
   return problem('طريقة الطلب غير مدعومة',405);
  }catch(e){return fail(e)}
 }
};
