import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { convertPreparation } from '../src/prep.ts';
const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
if (!args.includes('--input') || !args.includes('--out')) {
  console.log('node scripts/convert-prep.ts --input "明确的题卡与来源包.json" --out "data/待导入.json"');
  process.exit(0);
}
const input = resolve(option('--input')), output = resolve(option('--out'));
if (statSync(input).size > 10000000) throw new Error('准备包超过 10 MB');
const result = convertPreparation(JSON.parse(readFileSync(input, 'utf8')));
writeFileSync(output, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
console.log(`已转换 ${result.materials.length} 份资料。在模型与设置中选择此文件预览，不会直接修改数据库。`);
