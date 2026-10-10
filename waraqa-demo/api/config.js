export default {
 fetch(request){
  const supabaseUrl=process.env.SUPABASE_URL||'';
  const supabaseKey=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||'';
  const authConfigured=Boolean(supabaseUrl&&supabaseKey);
  const aiConfigured=Boolean(authConfigured&&process.env.SUPABASE_SERVICE_ROLE_KEY&&process.env.GEMINI_API_KEY);
  return Response.json({authConfigured,aiConfigured,teacherPays:false,supabaseUrl:authConfigured?supabaseUrl:'',supabaseKey:authConfigured?supabaseKey:''},{headers:{'Cache-Control':'no-store'}});
 }
};
