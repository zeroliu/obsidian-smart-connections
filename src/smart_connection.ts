import * as Obsidian from 'obsidian';
import type SmartConnectionsPlugin from 'src';
import { SUPPORTED_FILE_TYPES } from 'src/constants';

export const SMART_CONNECTIONS_VIEW_TYPE = 'smart-connections-view';
export class SmartConnectionsView extends Obsidian.ItemView {
  private nearest: any = null;
  private load_wait: any = null;
  private search_timeout: any = null;
  private interval: any = null;
  private interval_count: number = 0;
  private rendering: boolean = false;
  private file: any = null;
  private api: SmartConnectionsViewApi;

  constructor(
    leaf: Obsidian.WorkspaceLeaf,
    private plugin: SmartConnectionsPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return SMART_CONNECTIONS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Smart Connections Files';
  }

  getIcon(): string {
    return 'smart-connections';
  }

  set_message(message: string | string[]): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.innerHTML = ''; // clear container
    this.initiate_top_bar(container);
    if (Array.isArray(message)) {
      for (let i = 0; i < message.length; i++) {
        container.createEl('p', { cls: 'sc_message', text: message[i] });
      }
    } else {
      container.createEl('p', { cls: 'sc_message', text: message });
    }
  }

  render_link_text(link: string, show_full_path: boolean = false): string {
    if (!show_full_path) {
      link = link.split('/').pop() || link;
    }
    if (link.indexOf('#') > -1) {
      link = link.split('.md').join('');
      link = link.replace(/\#/g, ' » ');
    } else {
      link = link.replace('.md', '');
    }
    return link;
  }

  set_nearest(
    nearest: any,
    nearest_context: string | null = null,
    results_only: boolean = false,
  ): void {
    const container = this.containerEl.children[1] as HTMLElement;
    if (!results_only) {
      container.innerHTML = ''; // clear container
      this.initiate_top_bar(container, nearest_context);
    }
    this.plugin.update_results(container, nearest);
  }

  initiate_top_bar(
    container: HTMLElement,
    nearest_context: string | null = null,
  ): void {
    let top_bar: HTMLElement;
    if (
      container.children.length > 0 &&
      container.children[0].classList.contains('sc-top-bar')
    ) {
      top_bar = container.children[0] as HTMLElement;
      top_bar.innerHTML = ''; // empty it
    } else {
      top_bar = container.createEl('div', { cls: 'sc-top-bar' });
    }
    if (nearest_context) {
      top_bar.createEl('p', { cls: 'sc-context', text: nearest_context });
    }
    const chat_button = top_bar.createEl('button', { cls: 'sc-chat-button' });
    Obsidian.setIcon(chat_button, 'message-square');
    chat_button.addEventListener('click', () => {
      this.plugin.open_chat();
    });
    const search_button = top_bar.createEl('button', {
      cls: 'sc-search-button',
    });
    Obsidian.setIcon(search_button, 'search');
    search_button.addEventListener('click', () => {
      top_bar.innerHTML = ''; // empty top bar
      const search_container = top_bar.createEl('div', {
        cls: 'search-input-container',
      });
      const input = search_container.createEl('input', {
        cls: 'sc-search-input',
        type: 'search',
        placeholder: 'Type to start search...',
      });
      input.focus();
      input.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          this.clear_auto_searcher();
          this.initiate_top_bar(container, nearest_context);
        }
      });
      input.addEventListener('keyup', (event: KeyboardEvent) => {
        this.clear_auto_searcher();
        const search_term = input.value;
        if (event.key === 'Enter' && search_term !== '') {
          this.search(search_term);
        } else if (search_term !== '') {
          this.search_timeout = setTimeout(() => {
            this.search(search_term, true);
          }, 700);
        }
      });
    });
  }

  render_embeddings_buttons(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.innerHTML = ''; // clear container
    container.createEl('h2', {
      cls: 'scHeading',
      text: 'Embeddings file not found',
    });
    const button_div = container.createEl('div', { cls: 'scButtonDiv' });
    const create_button = button_div.createEl('button', {
      cls: 'scButton',
      text: 'Create embeddings.json',
    });
    button_div.createEl('p', {
      cls: 'scButtonNote',
      text: 'Warning: Creating embeddings.json file will trigger bulk embedding and may take a while',
    });
    const retry_button = button_div.createEl('button', {
      cls: 'scButton',
      text: 'Retry',
    });
    button_div.createEl('p', {
      cls: 'scButtonNote',
      text: "If embeddings.json file already exists, click 'Retry' to load it",
    });
    create_button.addEventListener('click', async () => {
      await this.plugin.smart_vec_lite.init_embeddings_file();
      await this.render_connections();
    });
    retry_button.addEventListener('click', async () => {
      console.log('retrying to load embeddings.json file');
      await this.plugin.init_vecs();
      await this.render_connections();
    });
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.innerHTML = ''; // clear container
    container.createEl('p', {
      cls: 'scPlaceholder',
      text: 'Open a note to find connections.',
    });
    this.plugin.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (!file) {
          return;
        }
        if (SUPPORTED_FILE_TYPES.indexOf(file.extension) === -1) {
          return this.set_message([
            'File: ' + file.name,
            'Unsupported file type (Supported: ' +
              SUPPORTED_FILE_TYPES.join(', ') +
              ')',
          ]);
        }
        if (this.load_wait) {
          clearTimeout(this.load_wait);
        }
        this.load_wait = setTimeout(() => {
          this.render_connections(file);
          this.load_wait = null;
        }, 1000);
      }),
    );
    this.app.workspace.registerHoverLinkSource(SMART_CONNECTIONS_VIEW_TYPE, {
      display: 'Smart Connections Files',
      defaultMod: true,
    });
    this.app.workspace.onLayoutReady(this.initialize.bind(this));
  }

  async initialize(): Promise<void> {
    this.set_message('Loading embeddings file...');
    const vecs_intiated = await this.plugin.init_vecs();
    if (vecs_intiated) {
      this.set_message('Embeddings file loaded.');
      await this.render_connections();
    } else {
      this.render_embeddings_buttons();
    }
    this.api = new SmartConnectionsViewApi(this.app, this.plugin, this);
    (window['SmartConnectionsViewApi'] = this.api) &&
      this.register(() => delete window['SmartConnectionsViewApi']);
  }

  async onClose(): Promise<void> {
    console.log('closing smart connections view');
    this.app.workspace.unregisterHoverLinkSource(SMART_CONNECTIONS_VIEW_TYPE);
    this.plugin.view = null;
  }

  async render_connections(context: any = null): Promise<void> {
    console.log('rendering connections');
    if (!this.plugin.settings.api_key) {
      this.set_message(
        'An OpenAI API key is required to make Smart Connections',
      );
      return;
    }
    if (!this.plugin.embeddings_loaded) {
      await this.plugin.init_vecs();
    }
    if (!this.plugin.embeddings_loaded) {
      console.log('embeddings files still not loaded or yet to be created');
      this.render_embeddings_buttons();
      return;
    }
    this.set_message('Making Smart Connections...');
    if (typeof context === 'string') {
      const highlighted_text = context;
      await this.search(highlighted_text);
      return;
    }
    this.nearest = null;
    this.interval_count = 0;
    this.rendering = false;
    this.file = context;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.interval = setInterval(() => {
      if (!this.rendering) {
        if (this.file instanceof Obsidian.TFile) {
          this.rendering = true;
          this.render_note_connections(this.file);
        } else {
          // get current note
          this.file = this.app.workspace.getActiveFile();
          // if still no current note then return
          if (!this.file && this.count > 1) {
            clearInterval(this.interval);
            this.set_message('No active file');
            return;
          }
        }
      } else {
        if (this.nearest) {
          clearInterval(this.interval);
          // if nearest is a string then update view message
          if (typeof this.nearest === 'string') {
            this.set_message(this.nearest);
          } else {
            // set nearest connections
            this.set_nearest(this.nearest, 'File: ' + this.file.name);
          }
          // if render_log.failed_embeddings then update failed_embeddings.txt
          if (this.plugin.render_log.failed_embeddings.length > 0) {
            this.plugin.save_failed_embeddings();
          }
          // get object keys of render_log
          this.plugin.output_render_log();
          return;
        } else {
          this.interval_count++;
          this.set_message('Making Smart Connections...' + this.interval_count);
        }
      }
    }, 10);
  }

  async render_note_connections(file: Obsidian.TFile): Promise<void> {
    this.nearest = await this.plugin.find_note_connections(file);
  }

  clear_auto_searcher(): void {
    if (this.search_timeout) {
      clearTimeout(this.search_timeout);
      this.search_timeout = null;
    }
  }

  async search(
    search_text: string,
    results_only: boolean = false,
  ): Promise<void> {
    const nearest = await this.plugin.api.search(search_text);
    const nearest_context = `Selection: "${
      search_text.length > 100
        ? search_text.substring(0, 100) + '...'
        : search_text
    }"`;
    this.set_nearest(nearest, nearest_context, results_only);
  }
}

class SmartConnectionsViewApi {
  constructor(
    private app: Obsidian.App,
    private plugin: SmartConnectionsPlugin,
    private view: SmartConnectionsView,
  ) {}

  async search(search_text: string): Promise<any> {
    return await this.plugin.api.search(search_text);
  }

  async reload_embeddings_file(): Promise<void> {
    await this.plugin.init_vecs();
    await this.view.render_connections();
  }
}
