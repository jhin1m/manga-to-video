// Canh gác chiều TS → snapshot: sinh lại parity trong bộ nhớ, so với schemas/parity.json đã
// commit bên repo skill. Đổi một hằng ở lib/ mà quên `pnpm gen:parity` là test này đỏ.
//
// Chiều còn lại (snapshot → Python) do tests/test_parity.py bên repo skill canh.
//
// CI KHÔNG có repo skill nên thiếu skill = SKIP + exit 0, cố ý: test:unit phải xanh trên máy
// chỉ có repo này. Máy dev có cả hai repo mới thật sự kiểm được parity.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { buildParity, parityFileIn, resolveSkillDir } from './gen-parity.mjs';

const skillDir = resolveSkillDir();
if (!skillDir) {
  console.log('verify-parity: — SKIP không thấy repo skill (đặt MTV_SKILL_DIR để kiểm)');
  process.exit(0);
}

const file = parityFileIn(skillDir);
if (!existsSync(file)) {
  console.error(`verify-parity: ✗ thiếu ${file} — chạy \`pnpm gen:parity\``);
  process.exit(1);
}

const expected = buildParity();
const actual = JSON.parse(await readFile(file, 'utf8'));

// So theo đường dẫn khoá để báo ĐÚNG chỗ lệch, thay vì ném ra hai object khổng lồ.
const diffs: string[] = [];
function walk(exp: unknown, act: unknown, at: string): void {
  if (JSON.stringify(exp) === JSON.stringify(act)) return;
  const bothPlain = (v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (bothPlain(exp) && bothPlain(act)) {
    const keys = new Set([
      ...Object.keys(exp as object),
      ...Object.keys(act as object),
    ]);
    for (const k of keys) {
      walk((exp as Record<string, unknown>)[k], (act as Record<string, unknown>)[k], at ? `${at}.${k}` : k);
    }
    return;
  }
  if (Array.isArray(exp) && Array.isArray(act) && exp.length === act.length) {
    exp.forEach((v, i) => walk(v, act[i], `${at}[${i}]`));
    return;
  }
  diffs.push(`${at}\n    lib/ (đúng): ${JSON.stringify(exp)}\n    snapshot:    ${JSON.stringify(act)}`);
}
walk(expected, actual, '');

console.log(`verify-parity: ${file}`);
if (diffs.length === 0) {
  console.log('  ✓ snapshot khớp lib/');
  console.log('\nPARITY_ALL_PASS');
  process.exit(0);
}
for (const d of diffs) console.error(`  ✗ ${d}`);
console.error(
  `\nPARITY_FAILURES: ${diffs.length}` +
    '\nlib/ là nguồn chân lý: chạy `pnpm gen:parity` rồi commit snapshot bên repo skill' +
    '\n(và sửa Python cho khớp — ĐỪNG sửa ngược lib/ cho vừa snapshot).',
);
process.exit(1);
