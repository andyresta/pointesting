import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  getArtifactDir,
  getArtifactStream,
  saveArtifact,
} from '../artifact-storage';

const cleanupPaths: string[] = [];

test.afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((cleanupPath) =>
      rm(cleanupPath, { recursive: true, force: true }),
    ),
  );
});

test('menyimpan Buffer dan membacanya kembali lewat stream', async () => {
  const runId = `storage-buffer-${Date.now()}`;
  const artifactDir = await getArtifactDir(runId);
  cleanupPaths.push(artifactDir);

  const relativePath = await saveArtifact(
    runId,
    'console-log.json',
    Buffer.from('[{"type":"log"}]'),
  );

  expect(relativePath).toBe(
    `storage/artifacts/${runId}/console-log.json`,
  );

  const chunks: Buffer[] = [];
  for await (const chunk of getArtifactStream(relativePath)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  expect(Buffer.concat(chunks).toString('utf8')).toBe('[{"type":"log"}]');
});

test('memindahkan source path ke folder artifact final', async () => {
  const runId = `storage-path-${Date.now()}`;
  const artifactDir = await getArtifactDir(runId);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'artifact-storage-test-'));
  cleanupPaths.push(artifactDir, tempDir);

  const sourcePath = path.join(tempDir, 'trace.zip');
  await writeFile(sourcePath, Buffer.from('trace-content'));

  const relativePath = await saveArtifact(runId, 'trace.zip', sourcePath);
  expect(existsSync(sourcePath)).toBe(false);
  expect(
    await readFile(path.resolve(__dirname, '../../..', relativePath), 'utf8'),
  ).toBe('trace-content');
});

test('menolak path traversal di luar storage/artifacts', async () => {
  await expect(getArtifactDir('../keluar')).rejects.toThrow(
    'Path artifact berada di luar storage/artifacts',
  );
  expect(() => getArtifactStream('../package.json')).toThrow(
    'Path artifact berada di luar storage/artifacts',
  );
});
