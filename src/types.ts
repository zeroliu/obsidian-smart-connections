export interface SmartConnectionSettings {
  api_key: string;
  chat_open: boolean;
  file_exclusions: string;
  folder_exclusions: string;
  header_exclusions: string;
  path_only: string;
  show_full_path: boolean;
  expanded_view: boolean;
  group_nearest_by_file: boolean;
  language: string;
  log_render: boolean;
  log_render_files: boolean;
  recently_sent_retry_notice: boolean;
  skip_sections: boolean;
  smart_chat_model: string;
  view_open: boolean;
  version: string;
  failed_files: string[];
}

export type EmbeddingRequest = [
  string, // file key
  string, // embed inputs
  {
    mtime: number;
    path: string;
    hash?: string;
    parent?: string;
    size?: number;
  },
];
