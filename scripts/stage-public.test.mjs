import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { stagePublic } from './stage-public.mjs';

test('staging uses one release, omits inputs, and rejects mixed history', async () => {
  const workspace = process.cwd();
  const parent = path.resolve('build');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'stage-test-'));
  try {
    process.chdir(root);
    await mkdir('public/data/history', { recursive: true });
    const id = 'a'.repeat(64);
    await writeFile('public/data/manifest.json', JSON.stringify({ release_id: id }));
    await writeFile('public/data/zip-data.json', JSON.stringify({ release_id: id }));
    await writeFile('public/data/history/index.json', JSON.stringify({ release_id: id }));
    await writeFile('public/data/history/0213.json', '{"zips":{}}');
    await writeFile('public/data/zcta-meta.csv', 'input only');
    await writeFile('public/Logo.svg', '<svg/>');
    await stagePublic('dist');
    assert.equal(await readFile(`dist/data/releases/${id}/history/0213.json`, 'utf8'), '{"zips":{}}');
    await assert.rejects(stat('dist/data/zcta-meta.csv'), { code: 'ENOENT' });
    await assert.rejects(stat('dist/data/history'), { code: 'ENOENT' });
    await writeFile('public/data/history/index.json', JSON.stringify({ release_id: 'b'.repeat(64) }));
    await assert.rejects(stagePublic('mixed'), /one release/);
    await stagePublic('preview', true);
    assert.equal(await readFile('preview/Logo.svg', 'utf8'), '<svg/>');
    await assert.rejects(stat('preview/data'), { code: 'ENOENT' });
  } finally {
    process.chdir(workspace);
    if (path.dirname(path.resolve(root)) !== parent) throw Error('Unexpected test directory');
    await rm(root, { recursive: true, force: true });
  }
});
