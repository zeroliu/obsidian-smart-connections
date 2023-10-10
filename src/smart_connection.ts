import * as Obsidian from 'obsidian';
import SmartConnectionsPlugin from 'src';
import { SUPPORTED_FILE_TYPES } from 'src/constants';

export const SMART_CONNECTIONS_VIEW_TYPE = 'smart-connections-view';
export class SmartConnectionsView extends Obsidian.ItemView {
  constructor(
    leaf: Obsidian.WorkspaceLeaf,
    private plugin: SmartConnectionsPlugin,
  ) {
    super(leaf);
    this.nearest = null;
    this.load_wait = null;
  }
  getViewType() {
    return SMART_CONNECTIONS_VIEW_TYPE;
  }

  getDisplayText() {
    return 'Smart Connections Files';
  }

  getIcon() {
    return 'smart-connections';
  }

  set_message(message) {
    const container = this.containerEl.children[1];
    // clear container
    container.empty();
    // initiate top bar
    this.initiate_top_bar(container);
    // if mesage is an array, loop through and create a new p element for each message
    if (Array.isArray(message)) {
      for (let i = 0; i < message.length; i++) {
        container.createEl('p', { cls: 'sc_message', text: message[i] });
      }
    } else {
      // create p element with message
      container.createEl('p', { cls: 'sc_message', text: message });
    }
  }
  render_link_text(link, show_full_path = false) {
    /**
     * Begin internal links
     */
    // if show full path is false, remove file path
    if (!show_full_path) {
      link = link.split('/').pop();
    }
    // if contains '#'
    if (link.indexOf('#') > -1) {
      // split at .md
      link = link.split('.md');
      // wrap first part in <small> and add line break
      link[0] = `<small>${link[0]}</small><br>`;
      // join back together
      link = link.join('');
      // replace '#' with ' » '
      link = link.replace(/\#/g, ' » ');
    } else {
      // remove '.md'
      link = link.replace('.md', '');
    }
    return link;
  }

  set_nearest(nearest, nearest_context = null, results_only = false) {
    // get container element
    const container = this.containerEl.children[1];
    // if results only is false, clear container and initiate top bar
    if (!results_only) {
      // clear container
      container.empty();
      this.initiate_top_bar(container, nearest_context);
    }
    // update results
    this.plugin.update_results(container, nearest);
  }

  initiate_top_bar(container, nearest_context = null) {
    let top_bar;
    // if top bar already exists, empty it
    if (
      container.children.length > 0 &&
      container.children[0].classList.contains('sc-top-bar')
    ) {
      top_bar = container.children[0];
      top_bar.empty();
    } else {
      // init container for top bar
      top_bar = container.createEl('div', { cls: 'sc-top-bar' });
    }
    // if highlighted text is not null, create p element with highlighted text
    if (nearest_context) {
      top_bar.createEl('p', { cls: 'sc-context', text: nearest_context });
    }
    // add chat button
    const chat_button = top_bar.createEl('button', { cls: 'sc-chat-button' });
    // add icon to chat button
    Obsidian.setIcon(chat_button, 'message-square');
    // add click listener to chat button
    chat_button.addEventListener('click', () => {
      // open chat
      this.plugin.open_chat();
    });
    // add search button
    const search_button = top_bar.createEl('button', {
      cls: 'sc-search-button',
    });
    // add icon to search button
    Obsidian.setIcon(search_button, 'search');
    // add click listener to search button
    search_button.addEventListener('click', () => {
      // empty top bar
      top_bar.empty();
      // create input element
      const search_container = top_bar.createEl('div', {
        cls: 'search-input-container',
      });
      const input = search_container.createEl('input', {
        cls: 'sc-search-input',
        type: 'search',
        placeholder: 'Type to start search...',
      });
      // focus input
      input.focus();
      // add keydown listener to input
      input.addEventListener('keydown', (event) => {
        // if escape key is pressed
        if (event.key === 'Escape') {
          this.clear_auto_searcher();
          // clear top bar
          this.initiate_top_bar(container, nearest_context);
        }
      });

      // add keyup listener to input
      input.addEventListener('keyup', (event) => {
        // if this.search_timeout is not null then clear it and set to null
        this.clear_auto_searcher();
        // get search term
        const search_term = input.value;
        // if enter key is pressed
        if (event.key === 'Enter' && search_term !== '') {
          this.search(search_term);
        }
        // if any other key is pressed and input is not empty then wait 500ms and make_connections
        else if (search_term !== '') {
          // clear timeout
          clearTimeout(this.search_timeout);
          // set timeout
          this.search_timeout = setTimeout(() => {
            this.search(search_term, true);
          }, 700);
        }
      });
    });
  }

  // render buttons: "create" and "retry" for loading embeddings.json file
  render_embeddings_buttons() {
    // get container element
    const container = this.containerEl.children[1];
    // clear container
    container.empty();
    // create heading that says "Embeddings file not found"
    container.createEl('h2', {
      cls: 'scHeading',
      text: 'Embeddings file not found',
    });
    // create div for buttons
    const button_div = container.createEl('div', { cls: 'scButtonDiv' });
    // create "create" button
    const create_button = button_div.createEl('button', {
      cls: 'scButton',
      text: 'Create embeddings.json',
    });
    // note that creating embeddings.json file will trigger bulk embedding and may take a while
    button_div.createEl('p', {
      cls: 'scButtonNote',
      text: 'Warning: Creating embeddings.json file will trigger bulk embedding and may take a while',
    });
    // create "retry" button
    const retry_button = button_div.createEl('button', {
      cls: 'scButton',
      text: 'Retry',
    });
    // try to load embeddings.json file again
    button_div.createEl('p', {
      cls: 'scButtonNote',
      text: "If embeddings.json file already exists, click 'Retry' to load it",
    });

    // add click event to "create" button
    create_button.addEventListener('click', async (event) => {
      // create embeddings.json file
      await this.plugin.smart_vec_lite.init_embeddings_file();
      // reload view
      await this.render_connections();
    });

    // add click event to "retry" button
    retry_button.addEventListener('click', async (event) => {
      console.log('retrying to load embeddings.json file');
      // reload embeddings.json file
      await this.plugin.init_vecs();
      // reload view
      await this.render_connections();
    });
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    // placeholder text
    container.createEl('p', {
      cls: 'scPlaceholder',
      text: 'Open a note to find connections.',
    });

    // runs when file is opened
    this.plugin.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        // if no file is open, return
        if (!file) {
          // console.log("no file open, returning");
          return;
        }
        // return if file type is not supported
        if (SUPPORTED_FILE_TYPES.indexOf(file.extension) === -1) {
          return this.set_message([
            'File: ' + file.name,
            'Unsupported file type (Supported: ' +
              SUPPORTED_FILE_TYPES.join(', ') +
              ')',
          ]);
        }
        // run render_connections after 1 second to allow for file to load
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
    this.app.workspace.registerHoverLinkSource(
      SMART_CONNECTIONS_CHAT_VIEW_TYPE,
      {
        display: 'Smart Chat Links',
        defaultMod: true,
      },
    );

    this.app.workspace.onLayoutReady(this.initialize.bind(this));
  }

  async initialize() {
    this.set_message('Loading embeddings file...');
    const vecs_intiated = await this.plugin.init_vecs();
    if (vecs_intiated) {
      this.set_message('Embeddings file loaded.');
      await this.render_connections();
    } else {
      this.render_embeddings_buttons();
    }

    /**
     * EXPERIMENTAL
     * - window-based API access
     * - code-block rendering
     */
    this.api = new SmartConnectionsViewApi(this.app, this.plugin, this);
    // register API to global window object
    (window['SmartConnectionsViewApi'] = this.api) &&
      this.register(() => delete window['SmartConnectionsViewApi']);
  }

  async onClose() {
    console.log('closing smart connections view');
    this.app.workspace.unregisterHoverLinkSource(SMART_CONNECTIONS_VIEW_TYPE);
    this.plugin.view = null;
  }

  async render_connections(context = null) {
    console.log('rendering connections');
    // if API key is not set then update view message
    if (!this.plugin.settings.api_key) {
      this.set_message(
        'An OpenAI API key is required to make Smart Connections',
      );
      return;
    }
    if (!this.plugin.embeddings_loaded) {
      await this.plugin.init_vecs();
    }
    // if embedding still not loaded, return
    if (!this.plugin.embeddings_loaded) {
      console.log('embeddings files still not loaded or yet to be created');
      this.render_embeddings_buttons();
      return;
    }
    this.set_message('Making Smart Connections...');
    /**
     * Begin highlighted-text-level search
     */
    if (typeof context === 'string') {
      const highlighted_text = context;
      // get embedding for highlighted text
      await this.search(highlighted_text);
      return; // ends here if context is a string
    }

    /**
     * Begin file-level search
     */
    this.nearest = null;
    this.interval_count = 0;
    this.rendering = false;
    this.file = context;
    // if this.interval is set then clear it
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    // set interval to check if nearest is set
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

  async render_note_connections(file) {
    this.nearest = await this.plugin.find_note_connections(file);
  }

  clear_auto_searcher() {
    if (this.search_timeout) {
      clearTimeout(this.search_timeout);
      this.search_timeout = null;
    }
  }

  async search(search_text, results_only = false) {
    const nearest = await this.plugin.api.search(search_text);
    // render results in view with first 100 characters of search text
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

  async search(search_text: string) {
    return await this.plugin.api.search(search_text);
  }
  // trigger reload of embeddings file
  async reload_embeddings_file() {
    await this.plugin.init_vecs();
    await this.view.render_connections();
  }
}
