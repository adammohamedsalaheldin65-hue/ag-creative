// Netlify's build directory is separate from our backend and SQL code.
// Only browser HTML/JS assets are ever published.
import {cp,mkdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
const siteRoot=process.cwd();
const dist=join(siteRoot,'dist');
const assets=[
  'index.html','admin.html','student.html',
  'exam-variants.js','subscription-ui.js','book-summary.js',
  'teacher-quizzes.js','student-portal.js'
];
await rm(dist,{recursive:true,force:true});
await mkdir(dist,{recursive:true});
for(const name of assets){
  const source=join(siteRoot,name);
  if(!(await stat(source)).isFile())throw new Error('Missing website asset: '+name);
  await cp(source,join(dist,name));
  process.stdout.write('Published: '+name+'\n');
}
console.log('Finished creating safe Netlify static output:',dist);
