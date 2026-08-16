import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import { artifactRepository } from '../db/repositories/artifact.repository';
import type { ArtifactType } from '../db/repositories/types';
import { saveArtifact } from '../storage/artifact-storage';

export interface TempArtifactPaths {
  video?: string;
  trace?: string;
  consoleLog: string;
  networkLog: string;
}

interface ArtifactCandidate {
  type: ArtifactType;
  filename: string;
  sourcePath?: string;
}

/**
 * Keterangan: Memindahkan artifact yang tersedia dari temp directory ke
 * `./storage/artifacts/<testRunId>/` melalui storage layer Step 11, lalu
 * menyimpan metadata type/path/size untuk setiap file ke tabel artifact.
 * Video/trace opsional agar error browser awal tetap dapat menyimpan log JSON.
 */
export async function collectArtifacts(
  testRunId: string,
  tempPaths: TempArtifactPaths,
): Promise<void> {
  const candidates: ArtifactCandidate[] = [
    { type: 'video', filename: 'video.webm', sourcePath: tempPaths.video },
    { type: 'trace', filename: 'trace.zip', sourcePath: tempPaths.trace },
    {
      type: 'console_log',
      filename: 'console-log.json',
      sourcePath: tempPaths.consoleLog,
    },
    {
      type: 'network_log',
      filename: 'network-log.json',
      sourcePath: tempPaths.networkLog,
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.sourcePath) {
      continue;
    }

    const filePath = await saveArtifact(
      testRunId,
      candidate.filename,
      candidate.sourcePath,
    );
    const fileStat = await stat(path.resolve(__dirname, '../..', filePath));

    await artifactRepository.create({
      testRunId,
      type: candidate.type,
      filePath,
      sizeBytes: fileStat.size,
    });
  }
}
