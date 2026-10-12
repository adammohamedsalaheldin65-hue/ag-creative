# ورقة على Render (بديل مجاني لتجاوز مشاكل netlify.app في مصر)

## ليه بديل؟
ظهرت بلاغات عن تعذّر فتح عناوين netlify.app من شبكات مصرية رغم نجاح النشر. لا نعتبر Netlify متعطلًا بالضرورة؛ جرّبه من شبكة مختلفة أو VPN للتشخيص. Render خيار آخر للتجربة على عنوان onrender.com **لكن يجب اختبار وصوله من شبكة مصرية قبل اعتماده للطلاب**.

هذه النسخة تستخدم نفس قاعدة بيانات ورقة في Supabase ونفس Gemini API (بدون نسخ بيانات المستخدمين إلى قاعدة جديدة)؛ ولا تزيل النشر الحالي على Vercel أو Netlify.

## نشر مجاني على Render
1. افتح https://dashboard.render.com/ ، سجل بواسطة GitHub.
2. اختر **New → Web Service**، **Connect a repository**.
3. حدد المستودع `adammohamedsalaheldin65-hue/ag-creative` و`main`.
4. اضبط إعدادات الخدمة:
   - **Language / Runtime:** `Node`
   - **Root Directory:** `waraqa-demo`
   - **Build Command:** `node scripts/build-netlify.mjs`
   - **Start Command:** `node server-render.mjs`
   - **Instance Type:** `Free` (لا تختار باقة مدفوعة).
5. من **Environment** (Advanced أو Service → Environment) أضف القيم الصحيحة من إعدادات ورقة الحالية، **كأسرار داخل Render فقط**:
   - `SUPABASE_URL`: رابط مشروع ورقة `https://vhyygvbqemhqirbcycev.supabase.co`.
   - `SUPABASE_PUBLISHABLE_KEY`: مفتاح publishable أو anon العام للمشروع.
   - `SUPABASE_SERVICE_ROLE_KEY`: المفتاح السري للخادم من Supabase.
   - `GEMINI_API_KEY`: مفتاح Gemini الخاص بك.
   - `SUBSCRIPTION_ENABLED=true` (لو الاشتراكات مفعلة حاليًا).
   - `STUDENT_PORTAL_ENABLED=true` **بعد تشغيل SQL الخاص بالطلاب على Supabase**.
   - `ALLOW_ANONYMOUS_AI=false`.
   - `SUBSCRIPTION_ADMIN_TOKEN`: نفس سر الإدارة الموجود عندك لو إدارة الاشتراكات تعمل.
   - اترك إعدادات أسعار InstaPay كما كانت، أو انقل متغيراتها من إعدادات Vercel إذا خصّصتها.
6. اضغط **Create Web Service** وانتظر أن تصبح Live. سيظهر لك رابط بنهاية `onrender.com`.

## اختبار بعد التشغيل
1. افتح رابط Render الرئيسي `https://your-service.onrender.com/`، ثم `/api/config` و`/student.html`.
2. تحقق من ظهور `studentPortalEnabled:true` و`aiConfigured:true` في `/api/config`.
3. افتح Supabase المشروع الصحيح → Authentication → URL Configuration → Redirect URLs، أضف `https://your-service.onrender.com/**`، دون مسح رابط Vercel القديم.
4. سجّل حساب طالب ببريد جديد، أكّد البريد وسجّل الدخول.
5. سجل حساب معلم قديم، انشر امتحاناً موضوعياً، ثم حلّه من حساب الطالب.
6. جرّب الوصول من هاتف على شبكة مصرية أخرى، وليس VPN فقط، قبل إرسال الرابط لطلابك.

## حدود مهمة
- **الخدمة المجانية على Render تنام بعد نحو 15 دقيقة من عدم الاستخدام** وقد تستغرق قرابة دقيقة للعودة، لذلك هي مناسبة لاختبار الميزة وليست استضافة إنتاجية مضمونة للفصول والاختبارات الحقيقية.
- Render تمنح حصة استعمال شهرية للخدمة المجانية ويمكن تعليقها عند بلوغ الحدود، لذا لا تشغل خطط دفع تلقائي دون مراجعة.
- Gemini يتبع حصة حساب Google المجانية وحدود ورقة، وليس حصص Render.
- لا ترفع أسرار الخدمة على GitHub ولا ترسلها في المحادثة.
- `server-render.mjs` يعمل على Node22 ويشغّل الواجهات والـAPI من نطاق واحد؛ لا توجد حاجة لتعديل روابط الواجهة.
- اتبع HTTPS فقط على عنوان Render.
