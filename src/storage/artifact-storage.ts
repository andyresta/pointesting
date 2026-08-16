import { createReadStream, type ReadStream } from 'node:fs';
import { copyFile, mkdir, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ARTIFACT_ROOT = path.join(PROJECT_ROOT, 'storage', 'artifacts');

/**
 * Keterangan: Memastikan path tujuan tetap berada di dalam root artifact agar
 * filename/path dari luar tidak bisa melakukan directory traversal.
 */
function assertInsideArtifactRoot(targetPath: string): void {
  const relative = path.relative(ARTIFACT_ROOT, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path artifact berada di luar storage/artifacts');
  }
}

/**
 * Keterangan: Mengembalikan folder final artifact untuk satu run dan membuat
 * folder `./storage/artifacts/<runId>/` secara rekursif bila belum ada.
 */
export async function getArtifactDir(runId: string): Promise<string> {
  const artifactDir = path.join(ARTIFACT_ROOT, runId);
  assertInsideArtifactRoot(artifactDir);
  await mkdir(artifactDir, { recursive: true });
  return artifactDir;
}

/**
 * Keterangan: Menyimpan Buffer atau memindahkan file sumber ke folder final
 * satu run. Untuk source path digunakan copy+unlink agar tetap bekerja saat
 * temp directory dan project berada di filesystem/device berbeda. Nilai balik
 * adalah path relatif project yang aman disimpan ke kolom artifact.file_path.
 */
export async function saveArtifact(
  runId: string,
  filename: string,
  source: Buffer | string,
): Promise<string> {
  const artifactDir = await getArtifactDir(runId);
  const safeFilename = path.basename(filename);
  const destination = path.join(artifactDir, safeFilename);
  assertInsideArtifactRoot(destination);

  if (Buffer.isBuffer(source)) {
    await writeFile(destination, source);
  } else {
    const sourcePath = path.resolve(source);
    if (sourcePath !== destination) {
      await copyFile(sourcePath, destination);
      await unlink(sourcePath);
    }
  }

  return path.relative(PROJECT_ROOT, destination).split(path.sep).join('/');
}

/**
 * Keterangan: Mengubah path relatif artifact dari DB menjadi path absolut yang
 * sudah dipastikan tetap berada di dalam storage/artifacts.
 */
export function getArtifactPath(filePath: string): string {
  const absolutePath = path.resolve(PROJECT_ROOT, filePath);
  assertInsideArtifactRoot(absolutePath);
  return absolutePath;
}

/**
 * Keterangan: Membuka ReadStream dari path relatif artifact yang tersimpan di
 * DB setelah memvalidasi bahwa path tersebut tetap di dalam storage/artifacts.
 */
export function getArtifactStream(filePath: string): ReadStream {
  return createReadStream(getArtifactPath(filePath));
}
