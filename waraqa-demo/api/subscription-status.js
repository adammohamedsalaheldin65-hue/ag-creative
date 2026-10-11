import {authenticate} from '../lib/auth.js';
import {getSubscription,subscriptionAccess,billingSettings,supabaseRest} from '../lib/billing.js';
import {result,fail} from '../lib/gemini.js';

export default {
 async fetch(request){
  try{
   if(request.method!=='GET')return result({error:'Method not allowed'},405);
   if(!billingSettings().enabled)return result({error:'الاشتراكات لم تفعّل بعد'},503);
   const auth=await authenticate(request,{requireAccess:false});
   if(auth.isAnonymous)return result({error:'سجل بحساب بريد إلكتروني أولًا'},401);
   const [subscription,receipts]=await Promise.all([
     getSubscription(auth.user.id),
     supabaseRest('subscription_payments?select=id,status,created_at,resolved_at,admin_note&user_id=eq.'+encodeURIComponent(auth.user.id)+'&order=created_at.desc&limit=5')
   ]);
   const expiry=subscription
      ?new Date(Math.max(Date.parse(subscription.trial_ends_at)||0,Date.parse(subscription.paid_until)||0)).toISOString()
      :null;
   return result({
     access:subscriptionAccess(subscription),
     trialStartedAt:subscription?.trial_started_at||null,
     trialEndsAt:subscription?.trial_ends_at||null,
     paidUntil:subscription?.paid_until||null,
     accessEndsAt:expiry,
     payments:Array.isArray(receipts)?receipts:[],
     paymentReady:billingSettings().paymentReady,
     priceEGP:billingSettings().price,
     destination:billingSettings().destination,
     accountName:billingSettings().accountName
   });
  }catch(e){return fail(e)}
 }
};
