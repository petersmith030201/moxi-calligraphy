// Offline CNChar reference for the types of strokes in a whole character.
// This file deliberately does NOT align names with animation stroke indices.
// Usage: node tools/prepare-stroke-types.mjs [cached-cnchar-3.2.6-directory]
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = path.resolve(process.argv[2] || path.join(root, '../../work/external-data/cnchar-3.2.6'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const licenseSha256 = 'd1bd3660226adebd251dcdd72972f7d254564247d6c5ec6b336532c09f496160';
const packages = [
  { name: 'cnchar', version: '3.2.6', archiveSha256: '4d02768878d178b5944b54b1bb92b319111d06082e3978347ab2305902af6d92', codeSha256: '1409ad05096831c28ffb62c809c2c6d946aedd583ae4f6ce5cd12a99ad2af998', licenseSha256 },
  { name: 'cnchar-order', version: '3.2.6', archiveSha256: '98112307108d5815203d6eeafae05fac332f2040433f006782e305e96e729d58', codeSha256: '3dbe473a9496d43c1ed8d782bc8673c500bac32d29cb3d72be72b25e82cdea38', licenseSha256 },
  { name: 'cnchar-trad', version: '3.2.6', archiveSha256: '89904ebd94780c89be07f39f67be3c1734314a0fbb08e7f8388e5b3b907231f4', codeSha256: 'a328be4b8143bae79ca2ea00558a3b65c411d456cef4ed75d5a59c52c9e9cc98', licenseSha256 },
];
// Check both downloaded archives and extracted code before executing the cache.
for (const item of packages) {
  const archive = await readFile(path.join(cache, `${item.name}.tgz`));
  const code = await readFile(path.join(cache, `${item.name}.cjs`));
  const license = await readFile(path.join(cache, `${item.name}-LICENSE`));
  const meta = JSON.parse(await readFile(path.join(cache, `${item.name}-package.json`), 'utf8'));
  if (sha256(archive) !== item.archiveSha256 || sha256(code) !== item.codeSha256 || sha256(license) !== item.licenseSha256 || meta.name !== item.name || meta.version !== item.version || meta.license !== 'MIT') {
    throw new Error(`Unexpected ${item.name} source cache; do not execute it.`);
  }
}
// All three packages carry the same upstream copyright/license notice.
if (sha256(await readFile(path.join(root, 'licenses/Cnchar-MIT.txt'))) !== licenseSha256) {
  throw new Error('Expected shared CNChar MIT notice is missing or changed.');
}
const require = createRequire(import.meta.url);
const cnchar = require(path.join(cache, 'cnchar.cjs'));
cnchar.use(require(path.join(cache, 'cnchar-order.cjs')), require(path.join(cache, 'cnchar-trad.cjs')));

const metadataBytes = await readFile(path.join(root, 'data/characters.json'));
const metadata = JSON.parse(metadataBytes.toString('utf8'));
const characters = {};
const orderedNames = {};
const ambiguousTypes = {};
const ambiguityGroups = new Map();
let missingCharacters = 0;
let rejectedCharacters = 0;
let ambiguousOccurrences = 0;
let normalizedPoint2Occurrences = 0;
let normalizedPoint2Characters = 0;
const normalizeName = name => name === '点2' ? '点' : name;
for (const character of Object.keys(metadata)) {
  const sequence = cnchar.stroke(character, 'order', 'name')?.[0];
  if (!Array.isArray(sequence) || !sequence.length) { missingCharacters++; continue; }
  const types = new Set();
  const candidates = new Set();
  const groupsForCharacter = new Map();
  let point2Occurrences = 0;
  let valid = true;
  let characterAmbiguities = 0;
  for (const raw of sequence) {
    if (typeof raw !== 'string') { valid = false; break; }
    const alternatives = raw.split('|').map(normalizeName);
    if (alternatives.some(name => !/^[\p{Script=Han}]{1,20}$/u.test(name))) { valid = false; break; }
    alternatives.forEach(name => types.add(name));
    if (raw === '点2') point2Occurrences++;
    if (alternatives.length > 1) {
      alternatives.forEach(name => candidates.add(name));
      groupsForCharacter.set(raw, alternatives);
      characterAmbiguities++;
    }
  }
  // A malformed source row is omitted in full, never partly filled by inference.
  if (!valid) { rejectedCharacters++; continue; }
  characters[character] = [...types];
  orderedNames[character] = sequence.map(raw => raw.split('|').map(normalizeName));
  if (candidates.size) ambiguousTypes[character] = [...candidates];
  for (const [raw, alternatives] of groupsForCharacter) ambiguityGroups.set(raw, alternatives);
  ambiguousOccurrences += characterAmbiguities;
  normalizedPoint2Occurrences += point2Occurrences;
  if (point2Occurrences) normalizedPoint2Characters++;
}

const data = {
  schemaVersion: 1,
  source: {
    name: 'CNChar 整字笔画类型参考', version: '3.2.6',
    url: 'https://github.com/theajack/cnchar',
    documentationUrl: 'https://theajack.github.io/cnchar/doc/order.html',
    license: 'MIT', licenseFile: 'licenses/Cnchar-MIT.txt',
    referenceMode: 'character-types-only', mapsToAnimationStrokeIndex: false,
    notice: '这里列出一个字涉及的笔画类型，用于一次检索全部相关个人笔记；不对应动画第几笔，也不据此判断笔画长短或具体写法。',
    caveats: [
      'CNChar 名称数据与 Make Me a Hanzi 动画轨迹来自不同来源。本表是整字类型参考，没有进行逐笔顺序对齐。',
      'CNChar 部分编码合并多个名称；这些名称均保留为候选，ambiguousTypes 标出候选类型，不表示它们一定同时出现在该字中。',
      '源名称“点2”归并为“点”；这种检索标签归并不改变动画数据，也不代表两种点画的实际形态完全相同。',
      '未识别和无效名称的字不收录，不根据设备字体或 SVG 轨迹补造名称。',
      '相关笔记仍须核对原文条件；列出笔画类型不能自动判断具体写法是否适用。',
    ],
    coverage: {
      queriedCharacters: Object.keys(metadata).length,
      coveredCharacters: Object.keys(characters).length,
      missingCharacters, rejectedCharacters,
      ambiguousCharacters: Object.keys(ambiguousTypes).length,
      ambiguousOccurrences,
    },
    conversions: {
      normalizedLabels: { 点2: '点' },
      normalizedPoint2Occurrences, normalizedPoint2Characters,
      ambiguousLabels: Object.fromEntries(ambiguityGroups),
      duplicates: '每个字的名称去重，仅保留首次出现的类型；数组顺序不表示逐笔序号。',
    },
    inputMetadataSha256: sha256(metadataBytes),
    packages: packages.map(item => ({ ...item, url: `https://registry.npmjs.org/${item.name}/-/${item.name}-${item.version}.tgz` })),
  },
  characters,
  ambiguousTypes,
  orderReference: {
    source: 'CNChar 3.2.6',
    reviewedAgainstAnimation: false,
    notice: 'CNChar 笔顺名称序列参考，未与动画逐笔全面核对；仅在名称数量与动画笔画数一致时按序显示，数量一致不保证两库顺序一致。候选名称不代表同时存在。',
    characters: orderedNames,
  },
};
const output = `${JSON.stringify(data, null, 2)}\n`;
await writeFile(path.join(root, 'data/stroke-types.json'), output, 'utf8');
console.log(JSON.stringify({ ...data.source.coverage, normalizedPoint2Occurrences, bytes: Buffer.byteLength(output) }));
