import { lstat, readdir, readFile, realpath, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The deployment artifact is an allow-list, never an upload of the repository.
const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const destination = path.join(root, 'dist');
const entries = ['index.html', 'styles.css', 'app.js', 'pdf-local.js', 'data', 'vendor', 'licenses'];
const approved = new Map();
const unsafeName = /(?:^|[\/\\])(?:\.env(?:\..*)?|\.git|secrets?(?:\..*)?|credentials?(?:\..*)?|id_rsa|id_ed25519)(?:$|[\/\\])/i;
const forbiddenExtension = /\.(?:pdf|png|jpe?g|gif|webp|svg|tiff?|bmp|heic|avif|ico|zip|7z|pem|key|p12|pfx|db|sqlite3?)$/i;
const secretValue = /-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----|\b(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b/;

function withinRoot(relative) {
  const absolute = path.resolve(root, relative);
  const back = path.relative(root, absolute);
  if (!back || back.startsWith('..') || path.isAbsolute(back)) throw new Error(`Unsafe source path: ${relative}`);
  return absolute;
}

function validateFile(relative, bytes) {
  const slashPath = relative.split(path.sep).join('/');
  if (unsafeName.test(slashPath) || forbiddenExtension.test(slashPath)) throw new Error(`Private or image asset is not publishable: ${slashPath}`);
  const branch = slashPath.split('/')[0];
  const extension = path.extname(relative).toLowerCase();
  if (branch === 'data' && extension !== '.json') throw new Error(`Only JSON data may be published: ${slashPath}`);
  if (branch === 'vendor' && !['.js', '.mjs'].includes(extension)) throw new Error(`Unapproved vendor file: ${slashPath}`);
  if (branch === 'licenses' && !['.txt', '.md', ''].includes(extension)) throw new Error(`Unapproved license file: ${slashPath}`);
  if (bytes.subarray(0, 5).toString() === '%PDF-' || bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)) throw new Error(`Disguised PDF/image found: ${slashPath}`);
  const text = bytes.toString('utf8');
  if (secretValue.test(text)) throw new Error(`Potential credential found; refusing publication: ${slashPath}`);
  if (extension === '.json') JSON.parse(text);
}

async function collect(relative) {
  const absolute = withinRoot(relative);
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink()) throw new Error(`Symbolic links cannot enter the artifact: ${relative}`);
  if (stat.isDirectory()) {
    for (const name of (await readdir(absolute)).sort()) await collect(path.join(relative, name));
  } else if (stat.isFile()) {
    const bytes = await readFile(absolute);
    validateFile(relative, bytes);
    approved.set(relative, bytes);
  } else throw new Error(`Unsupported filesystem entry: ${relative}`);
}

// Validate every input before replacing an earlier successful artifact.
for (const entry of entries) await collect(entry);

function assertDestination() {
  if (path.relative(root, destination) !== 'dist' || path.dirname(destination) !== root) throw new Error('Refusing to modify a directory other than this project/dist');
}

async function rejectOutputLinks(directory) {
  for (const name of await readdir(directory)) {
    const absolute = path.join(directory, name);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error('Refusing to clear dist containing a symbolic link');
    if (stat.isDirectory()) await rejectOutputLinks(absolute);
  }
}

assertDestination();
try {
  const stat = await lstat(destination);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('dist must be a real directory');
  const canonical = await realpath(destination);
  if (path.relative(root, canonical) !== 'dist') throw new Error('dist resolved outside the expected output directory');
  await rejectOutputLinks(destination);
  assertDestination();
  await rm(destination, { recursive: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

await mkdir(destination);
for (const [relative, bytes] of approved) {
  const output = path.resolve(destination, relative);
  const back = path.relative(destination, output);
  if (back.startsWith('..') || path.isAbsolute(back)) throw new Error('Invalid artifact destination');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, bytes, { flag: 'wx' });
}
await writeFile(path.join(destination, '.nojekyll'), '');
console.log(`Built dist: ${approved.size} approved files; PDFs, images, server code and credentials are excluded.`);
