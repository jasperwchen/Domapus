import { cp, copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const excluded = new Set(['archive', 'zcta-meta.csv', 'zcta-geom.csv', 'orphans.json',
  'us_zip_codes.pmtiles.metadata.json', 'temp-geo', 'history', 'releases']);

export async function stagePublic(outDir, externalData = false) {
  await mkdir(outDir, { recursive: true });
  for (const entry of await readdir('public')) {
    if (entry !== 'data') await cp(`public/${entry}`, path.join(outDir, entry), { recursive: true });
  }
  if (externalData) return;
  const data = path.join(outDir, 'data');
  await mkdir(data, { recursive: true });
  for (const entry of await readdir('public/data')) {
    if (!excluded.has(entry)) await cp(`public/data/${entry}`, path.join(data, entry), { recursive: true });
  }
  const mf = JSON.parse(await readFile('public/data/manifest.json', 'utf8'));
  const root = mf.release_id ? path.join(data, 'releases', mf.release_id) : data;
  if (mf.release_id) {
    if (!/^[a-f0-9]{64}$/.test(mf.release_id)) throw Error('Invalid release ID');
    const snapshot = JSON.parse(await readFile('public/data/zip-data.json', 'utf8'));
    const history = JSON.parse(await readFile('public/data/history/index.json', 'utf8'));
    if (snapshot.release_id !== mf.release_id || history.release_id !== mf.release_id) {
      throw Error('Snapshot, history, and manifest must belong to one release');
    }
    await mkdir(root, { recursive: true });
    await cp('public/data/zip-data.json', path.join(root, 'zip-data.json'));
  }
  try {
    const files = await readdir('public/data/history');
    const destination = path.join(root, 'history');
    await mkdir(destination, { recursive: true });
    let cursor = 0;
    await Promise.all(Array.from({ length: 16 }, async () => {
      while (cursor < files.length) {
        const name = files[cursor++];
        if (name.endsWith('.json')) await copyFile(`public/data/history/${name}`, path.join(destination, name));
      }
    }));
  } catch (error) {
    if (error.code !== 'ENOENT' || mf.release_id) throw error;
  }
}
