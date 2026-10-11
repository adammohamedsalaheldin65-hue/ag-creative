import {billingSettings} from '../lib/billing.js';
export default {
 fetch(request){
  const supabaseUrl=process.env.SUPABASE_URL||'';
  const supabaseKey=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||'';
  const authConfigured=Boolean(supabaseUrl&&supabaseKey);
  const aiConfigured=Boolean(authConfigured&&process.env.SUPABASE_SERVICE_ROLE_KEY&&process.env.GEMINI_API_KEY);
  const subscription=billingSettings();
  const anonymousAIEnabled=Boolean(!subscription.enabled&&aiConfigured&&process.env.ALLOW_ANONYMOUS_AI==='true');
  return Response.json({authConfigured,aiConfigured,anonymousAIEnabled,teacherPays:subscription.enabled,subscriptionEnabled:subscription.enabled,subscriptionPriceEGP:subscription.price,subscriptionPaymentReady:subscription.paymentReady,instaPayDestination:subscription.destination,supabaseUrl:authConfigured?supabaseUrl:'',supabaseKey:authConfigured?supabaseKey:''},{headers:{'Cache-Control':'no-store'}});
 }
};
