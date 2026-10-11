// Defensive comparison of extracted screenshot data to the owner's configured
// InstaPay beneficiary and subscription price. An OCR match is NOT bank confirmation.
function arabicNormalized(value){
 return String(value??'')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[\u064B-\u065F\u0670\u0640]/g,'')
  .replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')
  .replace(/[^\p{L}\p{N}]+/gu,' ')
  .trim().replace(/\s+/g,' ');
}
function validAmount(value){
 if(value===null||value===undefined||value==='')return null;
 const n=Number(value);
 return Number.isFinite(n)&&n>0&&n<=10000000?n:null;
}
export function checkReceipt(ai,expectedName,expectedAmount){
 const shown=arabicNormalized(ai?.visibleRecipient||'');
 const expected=arabicNormalized(expectedName);
 let recipientMatch=null;
 if(expected&&shown){
   // A short registered name, e.g. "نهاد", may appear with family names.
   // Match a complete leading name token, not a substring inside another name.
   recipientMatch=expected===shown || (shown.startsWith(expected+' ')&&expected.length>=3);
 }
 const amount=validAmount(ai?.visibleAmount);
 const target=validAmount(expectedAmount);
 const amountMatch=amount!==null&&target!==null?Math.abs(amount-target)<0.005:null;
 const looksSuccessful=ai?.appearsSuccessful===true;
 const looksLikeReceipt=ai?.looksLikeReceipt===true;
 const allChecksPass=recipientMatch===true&&amountMatch===true&&looksSuccessful&&looksLikeReceipt;
 return {
   expectedRecipient:String(expectedName||'').trim().slice(0,140),
   expectedAmount:target,
   recipientMatch,
   amountMatch,
   imageSaysSuccess:looksSuccessful,
   looksLikeReceipt,
   allChecksPass,
   result:allChecksPass?'visually_matched':recipientMatch===false||amountMatch===false||!looksSuccessful||!looksLikeReceipt?'needs_review':'uncertain',
   warning:allChecksPass
      ?'الاسم والمبلغ وحالة نجاح التحويل ظاهرة ومتطابقة مبدئيًا، لكن هذا لا يؤكد استلام المال.'
      :'بيانات الإيصال غير مكتملة أو لا تطابق بيانات الحساب المطلوبة. يحتاج مراجعة يدوية.'
 };
}
