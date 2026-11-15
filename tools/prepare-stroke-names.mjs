// Offline, deliberately limited CNChar name mapping for the bundled SVG order.
// Usage: node tools/prepare-stroke-names.mjs [cached-cnchar-3.2.6-directory]
// The cache is not shipped. Verify upstream archives before running cached code.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = path.resolve(process.argv[2] || path.join(root, '../../work/external-data/cnchar-3.2.6'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const packages = [
  { name: 'cnchar', version: '3.2.6', archiveSha256: '4d02768878d178b5944b54b1bb92b319111d06082e3978347ab2305902af6d92', codeSha256: '1409ad05096831c28ffb62c809c2c6d946aedd583ae4f6ce5cd12a99ad2af998' },
  { name: 'cnchar-order', version: '3.2.6', archiveSha256: '98112307108d5815203d6eeafae05fac332f2040433f006782e305e96e729d58', codeSha256: '3dbe473a9496d43c1ed8d782bc8673c500bac32d29cb3d72be72b25e82cdea38' },
];
for (const item of packages) {
  const archive = await readFile(path.join(cache, `${item.name}.tgz`));
  const code = await readFile(path.join(cache, `${item.name}.cjs`));
  const meta = JSON.parse(await readFile(path.join(cache, `${item.name}-package.json`), 'utf8'));
  if (sha256(archive) !== item.archiveSha256 || sha256(code) !== item.codeSha256 || meta.name !== item.name || meta.version !== item.version || meta.license !== 'MIT') {
    throw new Error(`Unrecognized ${item.name} cache; do not execute or regenerate names from it.`);
  }
}
const require = createRequire(import.meta.url);
const cnchar = require(path.join(cache, 'cnchar.cjs'));
cnchar.use(require(path.join(cache, 'cnchar-order.cjs')));

// Explicitly reviewed sequence, never expand automatically to a whole database.
// Each sequence was compared with the bundled median count/order and the obvious
// start/end directions. These checks are not a geometric stroke-name classifier.
// CNChar has combined labels, so the ambiguous name slots remain null.
const reviewed = {
  一: ['横'], 二: ['横', '横'], 三: ['横', '横', '横'], 十: ['横', '竖'],
  土: ['横', '竖', '横'], 王: ['横', '横', '竖', '横'],
  木: ['横', '竖', '撇', '捺'], 本: ['横', '竖', '撇', '捺', '横'],
  大: ['横', '撇', '捺'], 天: ['横', '横', '撇', '捺'], 人: ['撇', '捺'],
  口: ['竖', '横折', '横'], 日: ['竖', '横折', '横', '横'], 月: ['撇', '横折钩', '横', '横'],
  中: ['竖', '横折', '横', '竖'], 上: ['竖', '横', '横'], 下: ['横', '竖', '点'],
  干: ['横', '横', '竖'], 工: ['横', '竖', '横'], 川: ['撇', '竖', '竖'],
  手: ['撇', '横', '横', '竖钩'], 千: ['撇', '横', '竖'], 小: ['竖钩', '撇', '点'],
  永: ['点', '横折钩', null, '撇', '捺'], 水: ['竖钩', null, '撇', '捺'],
};
const characters = {};
const glyphSha256 = {};
for (const [character, expected] of Object.entries(reviewed)) {
  const sourceNames = cnchar.stroke(character, 'order', 'name')[0];
  const names = sourceNames.map(name => typeof name === 'string' && !name.includes('|') ? name : null);
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error(`Source names changed for ${character}; review required.`);
  const glyphBytes = await readFile(path.join(root, `data/characters/${character}.json`));
  const glyph = JSON.parse(glyphBytes.toString('utf8'));
  if (glyph.character !== character || glyph.strokes?.length !== names.length || glyph.medians?.length !== names.length) {
    throw new Error(`Stroke count/order mapping invalid for ${character}.`);
  }
  characters[character] = names;
  glyphSha256[character] = sha256(glyphBytes);
}
const data = {
  schemaVersion: 1,
  source: {
    name: 'CNChar 名称参考（有限核对）', version: '3.2.6',
    url: 'https://github.com/theajack/cnchar', license: 'MIT',
    notice: `仅收录 ${Object.keys(characters).length} 个已核对名称序列的常用字。名称与原笔顺轨迹来自不同数据源，可手动调整；不代表全部汉字已审校。`,
    caveats: [
      '仅核对这批字的笔画数量、序列和明显轨迹方向；没有按轨迹自动推断笔画名称，也未证明所有笔画术语只有一种叫法。',
      'CNChar 将部分不同名称合并为同一编码；含“|”的歧义名称保留为 null，须手动选择。永的第3笔、水的第2笔因此没有自动名称。',
      '未收录的汉字和长度不符的记录不能套用本表；动画仍使用 Make Me a Hanzi 的原始轨迹。',
      '笔画名称用于检索相关个人笔记，不表示某条笔记适用于当前笔画的长短、形状或书写方法。',
    ],
    packages: packages.map(({ name, version, archiveSha256, codeSha256 }) => ({
      name, version, url: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, archiveSha256, codeSha256,
    })),
    glyphSha256,
  },
  characters,
};
const license = await readFile(path.join(cache, 'cnchar-LICENSE'), 'utf8');
if (!license.includes('The MIT License (MIT)') || !license.includes('Copyright (c) 2017 - present theajack')) throw new Error('Expected upstream license missing.');
await writeFile(path.join(root, 'data/stroke-names.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
await writeFile(path.join(root, 'licenses/Cnchar-MIT.txt'), license, 'utf8');
console.log(JSON.stringify({ characters: Object.keys(characters).length, namedStrokes: Object.values(characters).flat().filter(Boolean).length, unknownStrokes: Object.values(characters).flat().filter(name => name === null).length }));
