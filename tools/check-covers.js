// 校验 homeworks.js 所有 cover 引用的关卡是否存在于 course-data.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const COURSE = new Function(fs.readFileSync(path.join(root, 'course-data.js'), 'utf8') + ';return COURSE;')();
const ids = new Set();
COURSE.chapters.forEach(c => c.lessons.forEach(l => ids.add(l.id)));
const hw = fs.readFileSync(path.join(root, 'homeworks.js'), 'utf8');
const covers = [...hw.matchAll(/cover: ?"([^"]+)"/g)].map(m => m[1]);
let bad = 0;
for (const c of covers) {
  const refs = (c.match(/\d-[\w-]+/g) || []);
  const missing = refs.filter(r => !ids.has(r));
  if (missing.length) { bad++; console.log(c, '=> 缺失:', missing.join(',')); }
  else console.log(c, '=> OK');
}
process.exit(bad ? 1 : 0);
