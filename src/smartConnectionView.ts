import * as Obsidian from 'obsidian';
import type SmartConnectionsPlugin from 'src';
import { SUPPORTED_FILE_TYPES } from 'src/constants';

export const SMART_CONNECTIONS_VIEW_TYPE = 'smart-connections-view';
export class SmartConnectionsView extends Obsidian.ItemView {
  private nearest: any = null;
  private loadTimeout: any = null;
  private searchTimeout: any = null;
  private interval: any = null;
  private makeConnectionStartTime: number | null = null;
  private rendering: boolean = false;
  private file: any = null;

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

  private setMessage(message: string | string[]): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.innerHTML = ''; // clear container
    this.initiateTopBar(container);
    if (Array.isArray(message)) {
      for (let i = 0; i < message.length; i++) {
        container.createEl('p', { cls: 'sc_message', text: message[i] });
      }
    } else {
      container.createEl('p', { cls: 'sc_message', text: message });
    }
  }

  private setNearest(
    nearest: any,
    nearestContext: string | null = null,
    resultsOnly: boolean = false,
  ): void {
    const container = this.containerEl.children[1] as HTMLElement;
    if (!resultsOnly) {
      container.innerHTML = ''; // clear container
      this.initiateTopBar(container, nearestContext);
    }
    this.plugin.updateResults(container, nearest);
  }

  private initiateTopBar(
    container: HTMLElement,
    nearestContext: string | null = null,
  ): void {
    let topBar: HTMLElement;
    if (
      container.children.length > 0 &&
      container.children[0].classList.contains('sc-top-bar')
    ) {
      topBar = container.children[0] as HTMLElement;
      topBar.innerHTML = ''; // empty it
    } else {
      topBar = container.createEl('div', { cls: 'sc-top-bar' });
    }
    if (nearestContext) {
      topBar.createEl('p', { cls: 'sc-context', text: nearestContext });
    }
    const makeConnectionBtn = topBar.createEl('button', {
      cls: 'sc-make-connection-button',
    });
    Obsidian.setIcon(makeConnectionBtn, 'refresh-cw');
    makeConnectionBtn.addEventListener('click', () => {
      this.plugin.resetConnections();
    });
    const chatButton = topBar.createEl('button', { cls: 'sc-chat-button' });
    Obsidian.setIcon(chatButton, 'message-square');
    chatButton.addEventListener('click', () => {
      this.plugin.openChat();
    });
    const searchButton = topBar.createEl('button', {
      cls: 'sc-search-button',
    });
    Obsidian.setIcon(searchButton, 'search');
    searchButton.addEventListener('click', () => {
      topBar.innerHTML = ''; // empty top bar
      const searchContainer = topBar.createEl('div', {
        cls: 'search-input-container',
      });
      const input = searchContainer.createEl('input', {
        cls: 'sc-search-input',
        type: 'search',
        placeholder: 'Type to start search...',
      });
      input.focus();
      input.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          this.clearAutoSearcher();
          this.initiateTopBar(container, nearestContext);
        }
      });
      input.addEventListener('keyup', (event: KeyboardEvent) => {
        this.clearAutoSearcher();
        const searchTerm = input.value;
        if (event.key === 'Enter' && searchTerm !== '') {
          this.search(searchTerm);
        } else if (searchTerm !== '') {
          this.searchTimeout = setTimeout(() => {
            this.search(searchTerm, true);
          }, 700);
        }
      });
    });
  }

  private renderEmbeddingsButtons(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.innerHTML = ''; // clear container
    container.createEl('h2', {
      cls: 'scHeading',
      text: 'Embeddings file not found',
    });
    const buttonDiv = container.createEl('div', { cls: 'scButtonDiv' });
    const createButton = buttonDiv.createEl('button', {
      cls: 'scButton',
      text: 'Create embeddings.json',
    });
    buttonDiv.createEl('p', {
      cls: 'scButtonNote',
      text: 'Warning: Creating embeddings.json file will trigger bulk embedding and may take a while',
    });
    const retryButton = buttonDiv.createEl('button', {
      cls: 'scButton',
      text: 'Retry',
    });
    buttonDiv.createEl('p', {
      cls: 'scButtonNote',
      text: "If embeddings.json file already exists, click 'Retry' to load it",
    });
    createButton.addEventListener('click', async () => {
      await this.plugin.smartVecLite?.initEmbeddingsFile();
      await this.renderConnections();
    });
    retryButton.addEventListener('click', async () => {
      console.log('retrying to load embeddings.json file');
      await this.plugin.initVecs();
      await this.renderConnections();
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
          return this.setMessage([
            'File: ' + file.name,
            'Unsupported file type (Supported: ' +
              SUPPORTED_FILE_TYPES.join(', ') +
              ')',
          ]);
        }
        if (this.loadTimeout) {
          clearTimeout(this.loadTimeout);
        }
        this.loadTimeout = setTimeout(() => {
          this.renderConnections(file);
          this.loadTimeout = null;
        }, 1000);
      }),
    );
    this.app.workspace.onLayoutReady(this.initialize.bind(this));
  }

  async initialize(): Promise<void> {
    this.setMessage('Loading embeddings file...');
    const vecsIntiated = await this.plugin.initVecs();
    if (vecsIntiated) {
      this.setMessage('Embeddings file loaded.');
      await this.renderConnections();
    } else {
      this.renderEmbeddingsButtons();
    }
  }

  async onClose(): Promise<void> {
    console.log('closing smart connections view');
  }

  async renderConnections(context?: Obsidian.TFile | string): Promise<void> {
    console.log('rendering connections');
    if (!this.plugin.settings.api_key) {
      this.setMessage(
        'An OpenAI API key is required to make Smart Connections',
      );
      return;
    }
    if (!this.plugin.embeddingsLoaded) {
      await this.plugin.initVecs();
    }
    if (!this.plugin.embeddingsLoaded) {
      console.log('embeddings files still not loaded or yet to be created');
      this.renderEmbeddingsButtons();
      return;
    }
    this.setMessage('Making Smart Connections...');
    if (typeof context === 'string') {
      const highlightedText = context;
      await this.search(highlightedText);
      return;
    }
    this.nearest = null;
    this.makeConnectionStartTime = Date.now();
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
          this.renderNoteConnections(this.file);
        } else {
          // get current note
          this.file = this.app.workspace.getActiveFile();
          // if still no current note then return
          if (!this.file) {
            clearInterval(this.interval);
            this.setMessage('No active file');
            return;
          }
        }
      } else {
        if (this.nearest) {
          clearInterval(this.interval);
          // if nearest is a string then update view message
          if (typeof this.nearest === 'string') {
            this.setMessage(this.nearest);
          } else {
            // set nearest connections
            this.setNearest(this.nearest, 'File: ' + this.file.name);
          }
          // if render_log.failed_embeddings then update failed_embeddings.txt
          if (this.plugin.renderLog.failed_embeddings.length > 0) {
            this.plugin.saveFailedEmbeddings();
          }
          // get object keys of render_log
          this.plugin.outputRenderLog();
          return;
        } else {
          const durationInSec = Math.floor(
            (Date.now() - this.makeConnectionStartTime) / 1000,
          );
          this.setMessage(`Making Smart Connections...${durationInSec}s`);
        }
      }
    }, 100);
  }

  private async renderNoteConnections(file: Obsidian.TFile): Promise<void> {
    this.nearest = await this.plugin.findNoteConnections(file);
  }

  private clearAutoSearcher(): void {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }
  }

  async search(
    searchText: string,
    resultsOnly: boolean = false,
  ): Promise<void> {
    const nearest = await this.plugin.api?.search(searchText);
    const nearestContext = `Selection: "${
      searchText.length > 100
        ? searchText.substring(0, 100) + '...'
        : searchText
    }"`;
    this.setNearest(nearest, nearestContext, resultsOnly);
  }
}
