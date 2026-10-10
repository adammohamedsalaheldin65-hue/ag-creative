export default {
  fetch(request) {
    return Response.json({aiConfigured:Boolean(process.env.GEMINI_API_KEY),provider:'platform',teacherPays:false},{headers:{'Cache-Control':'no-store'}});
  }
};
