# ورقة — تشغيل المعلمين والطلاب بدون بطاقة بنكية (Cloudflare Pages Free)

Cloudflare Free لا يتطلب بطاقة بنكية عند إنشاء حساب عادي وفق صفحة التسعير الرسمية. هذا بديل تجريبي لإطلاق ورقة بدون انتظار Vercel أو إضافة بطاقة Render، ولا يعد باستضافة مفتوحة بدون حدود.

## 1. إعداد الموقع
1. افتح https://dash.cloudflare.com/ وأنشئ حساباً مجانياً (Free) **بدون بطاقة**.
2. اذهب إلى **Workers & Pages → Create application → Pages → Connect to Git** (قد تختلف أسماء الأزرار مع تغيّر الواجهة؛ اختر **Pages** وليس بدء عامل Workers جديد من الصفر).
3. اربط GitHub واختر المستودع `adammohamedsalaheldin65-hue/ag-creative`.
4. إعدادات البناء:
   - Production branch: `main`
   - Framework preset: `None`
   - Root directory (advanced): `waraqa-demo`
   - Build command: `node scripts/build-netlify.mjs`
   - Build output directory: `dist`
5. الـPages Functions تُقرأ من `waraqa-demo/functions/api/[name].js` ومترجمة أثناء نشر Git تلقائياً. **لا تستخدم Direct Upload**؛ لا يدعم Functions في هذا المسار.
6. في إعدادات Pages Functions اختار **Compatibility date = 2026-10-12** للـProduction والـPreview؛ وهذا يفعل Node compatibility الافتراضي وفق وثائق Cloudflare بعد 2026-08-04، بما فيه Buffer وprocess.env وnode:crypto. إذا كانت الواجهة تطلب Flag على أقدم تاريخ: `nodejs_compat` + `nodejs_compat_populate_process_env`.
7. لن تحتاج إلى ضبط مسارات API يدوياً؛ `/api/config` وبقية Endpoints مربوطة بالفعل بصفحة Functions.

## 2. ربط حسابات Supabase و Gemini بأمان
من **Workers & Pages → مشروع ورقة → Settings → Variables and Secrets** أضف هذه القيم داخل بيئة Production؛ علّم المفاتيح السرية Encrypt/Secret إذا أمكن. **لا تشارك القيم في المحادثة أو على GitHub**.

| Key | Value |
|---|---|
| `SUPABASE_URL` | `https://vhyygvbqemhqirbcycev.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | نفس المفتاح العام الموجود على Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | المفتاح السري من Supabase، اختَر Encrypt |
| `GEMINI_API_KEY` | نفس مفتاح Google AI Studio، اختَر Encrypt |
| `GEMINI_MODEL` | اسم الموديل الموجود على Vercel، إذا كان مُخصّصاً |
| `SUBSCRIPTION_ENABLED` | `true` إذا اشتراكات ورقة القديمة مفعلة |
| `STUDENT_PORTAL_ENABLED` | `true` فقط بعد نجاح SQL الخاص ببوابة الطلاب |
| `ALLOW_ANONYMOUS_AI` | `false` |
| `SUBSCRIPTION_ADMIN_TOKEN` | نفس سرّ إدارة الدفعات (إن كنت تستخدم لوحة الدفع)، Encrypt |
| `INSTAPAY_DESTINATION`, `INSTAPAY_ACCOUNT_NAME` | نفس القيم الموجودة عندك إن كانت مخصصة |
| `SUBSCRIPTION_PRICE_EGP`, `PREMIUM_PRICE_EGP` | نفس الأسعار إن كنت غيّرتها |

ثم أعد نشر آخر Commit على Cloudflare Pages حتى تدخل الإعدادات حيز التنفيذ.

## 3. اختبار الموقع الجديد
بعد النشر يعطيك Cloudflare رابطاً بصيغة `https://<project>.pages.dev`.

1. افتح `/api/config`: لازم يعرض JSON وليس 404؛ إذا كان `studentPortalEnabled` false راجع متغيرات البيئة ثم تأكد من قاعدة البيانات. 
2. افتح `/student.html`: لازم تظهر واجهة الطلاب.
3. افتح الموقع الرئيسي `/`: لازم تظهر بوابة المعلم.
4. في Supabase الصحيح → Authentication → URL Configuration → Redirect URLs أضف نطاق Cloudflare الجديد `https://<project>.pages.dev/**` **مع الاحتفاظ بعناوين Vercel القديمة**.
5. جرّب الحسابات منفصلة، نشر امتحان، التصحيح وعرض النتائج.
6. جرّب رفع صورة درس وتشغيل Gemini؛ اختبر أيضًا الدفع قبل استخدامه مع مدرسين فعليين.

## حدود Cloudflare المجانية مهمة جدًا
- Pages Functions تستهلك حصة Workers Free: **100,000 طلب يومياً** عادة، و**10ms وقت CPU لكل طلب** (انتظار الشبكة لا يحسب ضمن CPU). هذا قد يكون غير كافٍ للمهام الثقيلة، خاصة ملفات الصور الكبيرة أو بعض إجراءات Gemini ورفع إيصالات الدفع. **التوافق ليس مضموناً قبل اختبار حي**، ولو ظهر Error 1102 تكون حصة CPU غير كافية.
- هذه نسخة تجريبية وليست إعلانًا باستعداد الإنتاج. 
- Gemini له حصة مجانية منفصلة، وحدود الطلاب/المعلمين في Supabase لا تزال واجبة.
- Cloudflare قد تحتاج تحققًا عبر البريد أو وسائل أخرى للحساب؛ لا تدخل بطاقة إذا لا تريد ذلك.
- لا تحذف تطبيق Vercel الحالي أو مفاتيحه أو قاعدة Supabase أو مشروع Netlify حتى تتأكد من جودة النسخة الجديدة.

المراجع:
- https://www.cloudflare.com/plans/
- https://developers.cloudflare.com/pages/get-started/git-integration/
- https://developers.cloudflare.com/pages/functions/get-started/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/configuration/compatibility-flags/
- https://developers.cloudflare.com/pages/functions/bindings/
