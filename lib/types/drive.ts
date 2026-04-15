export type DriveFileSource = 'workflow' | 'meeting';

export interface DriveAugmtdFile {
  id: string;            // artifactId within work_threads.artifacts
  title: string;
  type: string;          // DeliverableType
  source: DriveFileSource;
  folder_id?: string;
  size_bytes?: number;
  generated_at: string;
  work_thread_id?: string;
  storage_path?: string;
  is_indexed?: boolean;
  transcript_id?: string; // for meeting transcripts
}

export interface DriveFolder {
  id: string;
  name: string;
  parent_id: string | null;
  is_system: boolean;
  system_key?: string;
  created_at: string;
}

export interface DriveStats {
  total_files: number;
  augmtd_files: number;
  connected_folders: number;
  recently_updated: number;
}
