type AdapterFunction = (...args: any[]) => Promise<any>;

interface VecLiteConfig {
  file_name?: string;
  folder_path?: string;
  exists_adapter?: AdapterFunction;
  mkdir_adapter?: AdapterFunction;
  read_adapter?: AdapterFunction;
  rename_adapter?: AdapterFunction;
  stat_adapter?: AdapterFunction;
  write_adapter?: AdapterFunction;
}

interface Embedding {
  vec: number[];
  meta: {
    hash?: string;
    parent?: string;
    children?: string[];
    mtime?: number;
    size?: number;
    len?: number;
    path?: string;
    src?: string;
  };
}

interface NearestFilter {
  results_count?: number;
  skip_sections?: boolean;
  skip_key?: string;
  path_begins_with?: string | string[];
}

export interface NearestResult {
  link: string;
  similarity: number;
  size: number;
}

interface CleanupResult {
  deleted_embeddings: number;
  total_embeddings: number;
}

export class VecLite {
  private config: VecLiteConfig;
  private file_name: string;
  private folder_path: string;
  private file_path: string;
  private embeddings: Record<string, Embedding>;

  constructor(config: VecLiteConfig) {
    this.config = {
      file_name: 'embeddings-3.json',
      folder_path: '.vec_lite',
      exists_adapter: null,
      mkdir_adapter: null,
      read_adapter: null,
      rename_adapter: null,
      stat_adapter: null,
      write_adapter: null,
      ...config,
    };
    this.file_name = this.config.file_name;
    this.folder_path = config.folder_path;
    this.file_path = this.folder_path + '/' + this.file_name;
    this.embeddings = {};
  }

  async file_exists(path: string): Promise<boolean> {
    if (this.config.exists_adapter) {
      return await this.config.exists_adapter(path);
    } else {
      throw new Error('exists_adapter not set');
    }
  }

  async mkdir(path: string): Promise<void> {
    if (this.config.mkdir_adapter) {
      return await this.config.mkdir_adapter(path);
    } else {
      throw new Error('mkdir_adapter not set');
    }
  }

  async read_file(path: string): Promise<string> {
    if (this.config.read_adapter) {
      return await this.config.read_adapter(path);
    } else {
      throw new Error('read_adapter not set');
    }
  }

  async rename(old_path: string, new_path: string): Promise<void> {
    if (this.config.rename_adapter) {
      return await this.config.rename_adapter(old_path, new_path);
    } else {
      throw new Error('rename_adapter not set');
    }
  }

  async stat(path: string): Promise<{ size: number }> {
    if (this.config.stat_adapter) {
      return await this.config.stat_adapter(path);
    } else {
      throw new Error('stat_adapter not set');
    }
  }

  async write_file(path: string, data: string): Promise<void> {
    if (this.config.write_adapter) {
      return await this.config.write_adapter(path, data);
    } else {
      throw new Error('write_adapter not set');
    }
  }

  async load(retries: number = 0): Promise<boolean> {
    try {
      const embeddings_file = await this.read_file(this.file_path);
      this.embeddings = JSON.parse(embeddings_file);
      console.log('loaded embeddings file: ' + this.file_path);
      return true;
    } catch (error) {
      if (retries < 3) {
        console.log('retrying load()');
        await new Promise((r) => setTimeout(r, 1e3 + 1e3 * retries));
        return await this.load(retries + 1);
      }
      console.log(
        'failed to load embeddings file, prompt user to initiate bulk embed',
      );
      return false;
    }
  }

  async initEmbeddingsFile() {
    if (!(await this.file_exists(this.folder_path))) {
      await this.mkdir(this.folder_path);
      console.log('created folder: ' + this.folder_path);
    } else {
      console.log('folder already exists: ' + this.folder_path);
    }
    if (!(await this.file_exists(this.file_path))) {
      await this.write_file(this.file_path, '{}');
      console.log('created embeddings file: ' + this.file_path);
    } else {
      console.log('embeddings file already exists: ' + this.file_path);
    }
  }

  async save(): Promise<boolean> {
    const embeddings = JSON.stringify(this.embeddings);
    const embeddings_file_exists = await this.file_exists(this.file_path);
    if (embeddings_file_exists) {
      const new_file_size = embeddings.length;
      const existing_file_size = await this.stat(this.file_path).then(
        (stat) => stat.size,
      );
      if (new_file_size > existing_file_size * 0.5) {
        await this.write_file(this.file_path, embeddings);
        console.log('embeddings file size: ' + new_file_size + ' bytes');
      } else {
        const warning_message = [
          'Warning: New embeddings file size is significantly smaller than existing embeddings file size.',
          'Aborting to prevent possible loss of embeddings data.',
          'New file size: ' + new_file_size + ' bytes.',
          'Existing file size: ' + existing_file_size + ' bytes.',
          'Restarting Obsidian may fix this.',
        ];
        console.log(warning_message.join(' '));
        await this.write_file(
          this.folder_path + '/unsaved-embeddings.json',
          embeddings,
        );
        throw new Error(
          'Error: New embeddings file size is significantly smaller than existing embeddings file size. Aborting to prevent possible loss of embeddings data.',
        );
      }
    } else {
      await this.initEmbeddingsFile();
      return await this.save();
    }
    return true;
  }

  cosSim(vector1: number[], vector2: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vector1.length; i++) {
      dotProduct += vector1[i] * vector2[i];
      normA += vector1[i] * vector1[i];
      normB += vector2[i] * vector2[i];
    }
    if (normA === 0 || normB === 0) {
      return 0;
    } else {
      return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
  }
  findNearest(toVec: number[], filter: NearestFilter = {}): NearestResult[] {
    filter = {
      results_count: 30,
      ...filter,
    };
    let nearest: NearestResult[] = [];
    const fromKeys = Object.keys(this.embeddings);
    for (let i = 0; i < fromKeys.length; i++) {
      if (filter.skip_sections) {
        const from_path = this.embeddings[fromKeys[i]].meta.path;
        if (from_path && from_path.indexOf('#') > -1) continue;
      }
      if (filter.skip_key) {
        if (filter.skip_key === fromKeys[i]) continue;
        if (filter.skip_key === this.embeddings[fromKeys[i]].meta.parent)
          continue;
      }
      if (filter.path_begins_with) {
        if (
          typeof filter.path_begins_with === 'string' &&
          !this.embeddings[fromKeys[i]].meta.path?.startsWith(
            filter.path_begins_with,
          )
        )
          continue;
        if (
          Array.isArray(filter.path_begins_with) &&
          !filter.path_begins_with.some((path) =>
            this.embeddings[fromKeys[i]].meta.path?.startsWith(path),
          )
        )
          continue;
      }
      nearest.push({
        link: this.embeddings[fromKeys[i]].meta.path ?? '',
        similarity: this.cosSim(toVec, this.embeddings[fromKeys[i]].vec),
        size: this.embeddings[fromKeys[i]].meta.size ?? 0,
      });
    }
    nearest.sort(function (a, b) {
      return b.similarity - a.similarity;
    });
    nearest = nearest.slice(0, filter.results_count);
    return nearest;
  }
  // check if key from embeddings exists in files
  cleanUpEmbeddings(files: { path: string }[]): CleanupResult {
    console.log('cleaning up embeddings');
    const keys = Object.keys(this.embeddings);
    let deleted_embeddings = 0;
    for (const key of keys) {
      const path = this.embeddings[key].meta.path;
      if (!files.find((file) => path?.startsWith(file.path))) {
        delete this.embeddings[key];
        deleted_embeddings++;
        continue;
      }
      if (path && path.indexOf('#') > -1) {
        const parentKey = this.embeddings[key].meta.parent;
        if (!parentKey) {
          continue;
        }
        if (!this.embeddings[parentKey]) {
          delete this.embeddings[key];
          deleted_embeddings++;
          continue;
        }
        if (!this.embeddings[parentKey].meta) {
          delete this.embeddings[key];
          deleted_embeddings++;
          continue;
        }
        if (
          this.embeddings[parentKey].meta.children &&
          this.embeddings[parentKey].meta.children!.indexOf(key) < 0
        ) {
          delete this.embeddings[key];
          deleted_embeddings++;
          continue;
        }
      }
    }
    return { deleted_embeddings, total_embeddings: keys.length };
  }
  get(key: string): Embedding | null {
    return this.embeddings[key] || null;
  }
  get_meta(key: string): Embedding['meta'] | null {
    const embedding = this.get(key);
    if (embedding && embedding.meta) {
      return embedding.meta;
    }
    return null;
  }
  get_mtime(key: string): number | null {
    const meta = this.get_meta(key);
    if (meta && meta.mtime) {
      return meta.mtime;
    }
    return null;
  }
  getHash(key: string): string | null {
    const meta = this.get_meta(key);
    if (meta && meta.hash) {
      return meta.hash;
    }
    return null;
  }
  getSize(key: string): number | null {
    const meta = this.get_meta(key);
    if (meta && meta.size) {
      return meta.size;
    }
    return null;
  }
  getChildren(key: string): string[] | null {
    const meta = this.get_meta(key);
    if (meta && meta.children) {
      return meta.children;
    }
    return null;
  }
  getVec(key: string): number[] | null {
    const embedding = this.get(key);
    if (embedding && embedding.vec) {
      return embedding.vec;
    }
    return null;
  }
  saveEmbedding(key: string, vec: number[], meta: Embedding['meta']): void {
    this.embeddings[key] = {
      vec,
      meta,
    };
  }
  mtimeIsCurrent(key: string, source_mtime: number): boolean {
    const mtime = this.get_mtime(key);
    if (mtime && mtime >= source_mtime) {
      return true;
    }
    return false;
  }
  async forceRefresh() {
    this.embeddings = null;
    this.embeddings = {};
    let current_datetime = Math.floor(Date.now() / 1e3);
    await this.rename(
      this.file_path,
      this.folder_path + '/embeddings-' + current_datetime + '.json',
    );
    await this.initEmbeddingsFile();
  }
}
