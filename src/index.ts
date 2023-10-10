import * as Obsidian from 'obsidian';
import { VecLite } from './veclite';
import {
  DEFAULT_SETTINGS,
  SMART_TRANSLATION,
  MAX_EMBED_STRING_LENGTH,
} from './constants';
import { SmartConnectionSettings } from 'src/types';
import { SmartConnectionsSettingsTab } from 'src/settings';
import {
  SMART_CONNECTIONS_CHAT_VIEW_TYPE,
  SmartConnectionsChatView,
} from 'src/chat_view';
import {
  SMART_CONNECTIONS_VIEW_TYPE,
  SmartConnectionsView,
} from 'src/smart_connection';

let VERSION = '';

// require built-in crypto module
const crypto = require('crypto');
// md5 hash using built in crypto module
function md5(str: string) {
  return crypto.createHash('md5').update(str).digest('hex');
}

export default class SmartConnectionsPlugin extends Obsidian.Plugin {
  settings: SmartConnectionSettings;
  api = null;
  embeddings_loaded = false;
  file_exclusions = [];
  folders = [];
  has_new_embeddings = false;
  header_exclusions = [];
  nearest_cache = {};
  path_only = [];
  render_log: Record<string, any> = {};

  retry_notice_timeout = null;
  save_timeout = null;
  sc_branding = {};
  self_ref_kw_regex = null;
  update_available = false;

  // constructor
  constructor(app: Obsidian.App, manifest: Obsidian.PluginManifest) {
    super(app, manifest);
    this.render_log.deleted_embeddings = 0;
    this.render_log.exclusions_logs = {};
    this.render_log.failed_embeddings = [];
    this.render_log.files = [];
    this.render_log.new_embeddings = 0;
    this.render_log.skipped_low_delta = {};
    this.render_log.token_usage = 0;
    this.render_log.tokens_saved_by_cache = 0;
  }

  async onload() {
    // initialize when layout is ready
    this.app.workspace.onLayoutReady(() => this.initialize());
  }
  onunload() {
    this.output_render_log();
    console.log('unloading plugin');
    this.app.workspace.detachLeavesOfType(SMART_CONNECTIONS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(SMART_CONNECTIONS_CHAT_VIEW_TYPE);
  }
  async initialize() {
    console.log('Loading Smart Connections plugin');
    VERSION = this.manifest.version;

    await this.loadSettings();
    // run after 3 seconds
    setTimeout(this.check_for_update.bind(this), 3000);
    // run check for update every 3 hours
    setInterval(this.check_for_update.bind(this), 10800000);

    this.addIcon();
    this.addCommand({
      id: 'sc-find-notes',
      name: 'Find: Make Smart Connections',
      icon: 'pencil_icon',
      hotkeys: [],
      // editorCallback: async (editor) => {
      editorCallback: async (editor) => {
        if (editor.somethingSelected()) {
          // get selected text
          let selected_text = editor.getSelection();
          // render connections from selected text
          await this.make_connections(selected_text);
        } else {
          // clear nearest_cache on manual call to make connections
          this.nearest_cache = {};
          // console.log("Cleared nearest_cache");
          await this.make_connections();
        }
      },
    });
    this.addCommand({
      id: 'smart-connections-view',
      name: 'Open: View Smart Connections',
      callback: () => {
        this.open_view();
      },
    });
    // open chat command
    this.addCommand({
      id: 'smart-connections-chat',
      name: 'Open: Smart Chat Conversation',
      callback: () => {
        this.open_chat();
      },
    });
    // open random note from nearest cache
    this.addCommand({
      id: 'smart-connections-random',
      name: 'Open: Random Note from Smart Connections',
      callback: () => {
        this.open_random_note();
      },
    });
    // add settings tab
    this.addSettingTab(new SmartConnectionsSettingsTab(this.app, this));
    // register main view type
    this.registerView(
      SMART_CONNECTIONS_VIEW_TYPE,
      (leaf) => new SmartConnectionsView(leaf, this),
    );
    // register chat view type
    this.registerView(
      SMART_CONNECTIONS_CHAT_VIEW_TYPE,
      (leaf) => new SmartConnectionsChatView(leaf, this),
    );
    // code-block renderer
    this.registerMarkdownCodeBlockProcessor(
      'smart-connections',
      this.render_code_block.bind(this),
    );

    // if this settings.view_open is true, open view on startup
    if (this.settings.view_open) {
      this.open_view();
    }
    // if this settings.chat_open is true, open chat on startup
    if (this.settings.chat_open) {
      this.open_chat();
    }
    // on new version
    if (this.settings.version !== VERSION) {
      // update version
      this.settings.version = VERSION;
      // save settings
      await this.saveSettings();
      // open view
      this.open_view();
    }
    // check github release endpoint if update is available
    this.add_to_gitignore();
    /**
     * EXPERIMENTAL
     * - window-based API access
     * - code-block rendering
     */
    this.api = new ScSearchApi(this.app, this);
    // register API to global window object
    (window['SmartSearchApi'] = this.api) &&
      this.register(() => delete window['SmartSearchApi']);
  }

  async init_vecs() {
    this.smart_vec_lite = new VecLite({
      folder_path: '.smart-connections',
      exists_adapter: this.app.vault.adapter.exists.bind(
        this.app.vault.adapter,
      ),
      mkdir_adapter: this.app.vault.adapter.mkdir.bind(this.app.vault.adapter),
      read_adapter: this.app.vault.adapter.read.bind(this.app.vault.adapter),
      rename_adapter: this.app.vault.adapter.rename.bind(
        this.app.vault.adapter,
      ),
      stat_adapter: this.app.vault.adapter.stat.bind(this.app.vault.adapter),
      write_adapter: this.app.vault.adapter.write.bind(this.app.vault.adapter),
    });
    this.embeddings_loaded = await this.smart_vec_lite.load();
    return this.embeddings_loaded;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // load file exclusions if not blank
    if (
      this.settings.file_exclusions &&
      this.settings.file_exclusions.length > 0
    ) {
      // split file exclusions into array and trim whitespace
      this.file_exclusions = this.settings.file_exclusions
        .split(',')
        .map((file) => {
          return file.trim();
        });
    }
    // load folder exclusions if not blank
    if (
      this.settings.folder_exclusions &&
      this.settings.folder_exclusions.length > 0
    ) {
      // add slash to end of folder name if not present
      const folder_exclusions = this.settings.folder_exclusions
        .split(',')
        .map((folder) => {
          // trim whitespace
          folder = folder.trim();
          if (folder.slice(-1) !== '/') {
            return folder + '/';
          } else {
            return folder;
          }
        });
      // merge folder exclusions with file exclusions
      this.file_exclusions = this.file_exclusions.concat(folder_exclusions);
    }
    // load header exclusions if not blank
    if (
      this.settings.header_exclusions &&
      this.settings.header_exclusions.length > 0
    ) {
      this.header_exclusions = this.settings.header_exclusions
        .split(',')
        .map((header) => {
          return header.trim();
        });
    }
    // load path_only if not blank
    if (this.settings.path_only && this.settings.path_only.length > 0) {
      this.path_only = this.settings.path_only.split(',').map((path) => {
        return path.trim();
      });
    }
    // load self_ref_kw_regex
    this.self_ref_kw_regex = new RegExp(
      `\\b(${SMART_TRANSLATION[this.settings.language].pronous.join('|')})\\b`,
      'gi',
    );
    // load failed files
    await this.load_failed_files();
  }
  async saveSettings(rerender = false) {
    await this.saveData(this.settings);
    // re-load settings into memory
    await this.loadSettings();
    // re-render view if set to true (for example, after adding API key)
    if (rerender) {
      this.nearest_cache = {};
      await this.make_connections();
    }
  }

  // check for update
  async check_for_update() {
    // fail silently, ex. if no internet connection
    try {
      // get latest release version from github
      const response = await (0, Obsidian.requestUrl)({
        url: 'https://api.github.com/repos/brianpetro/obsidian-smart-connections/releases/latest',
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        contentType: 'application/json',
      });
      // get version number from response
      const latest_release = JSON.parse(response.text).tag_name;
      // console.log(`Latest release: ${latest_release}`);
      // if latest_release is newer than current version, show message
      if (latest_release !== VERSION) {
        new Obsidian.Notice(
          `[Smart Connections] A new version is available! (v${latest_release})`,
        );
        this.update_available = true;
        this.render_brand('all');
      }
    } catch (error) {
      console.log(error);
    }
  }

  async render_code_block(contents, container, ctx) {
    let nearest;
    if (contents.trim().length > 0) {
      nearest = await this.api.search(contents);
    } else {
      // use ctx to get file
      console.log(ctx);
      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      nearest = await this.find_note_connections(file);
    }
    if (nearest.length) {
      this.update_results(container, nearest);
    }
  }

  async make_connections(selected_text = null) {
    let view = this.get_view();
    if (!view) {
      // open view if not open
      await this.open_view();
      view = this.get_view();
    }
    await view.render_connections(selected_text);
  }

  addIcon() {
    Obsidian.addIcon(
      'smart-connections',
      `<path d="M50,20 L80,40 L80,60 L50,100" stroke="currentColor" stroke-width="4" fill="none"/>
    <path d="M30,50 L55,70" stroke="currentColor" stroke-width="5" fill="none"/>
    <circle cx="50" cy="20" r="9" fill="currentColor"/>
    <circle cx="80" cy="40" r="9" fill="currentColor"/>
    <circle cx="80" cy="70" r="9" fill="currentColor"/>
    <circle cx="50" cy="100" r="9" fill="currentColor"/>
    <circle cx="30" cy="50" r="9" fill="currentColor"/>`,
    );
  }

  // open random note
  async open_random_note() {
    const curr_file = this.app.workspace.getActiveFile();
    const curr_key = md5(curr_file.path);
    // if no nearest cache, create Obsidian notice
    if (typeof this.nearest_cache[curr_key] === 'undefined') {
      new Obsidian.Notice(
        '[Smart Connections] No Smart Connections found. Open a note to get Smart Connections.',
      );
      return;
    }
    // get random from nearest cache
    const rand = Math.floor(
      (Math.random() * this.nearest_cache[curr_key].length) / 2,
    ); // divide by 2 to limit to top half of results
    const random_file = this.nearest_cache[curr_key][rand];
    // open random file
    this.open_note(random_file);
  }

  async open_view() {
    if (this.get_view()) {
      console.log('Smart Connections view already open');
      return;
    }
    this.app.workspace.detachLeavesOfType(SMART_CONNECTIONS_VIEW_TYPE);
    await this.app.workspace.getRightLeaf(false).setViewState({
      type: SMART_CONNECTIONS_VIEW_TYPE,
      active: true,
    });
    this.app.workspace.revealLeaf(
      this.app.workspace.getLeavesOfType(SMART_CONNECTIONS_VIEW_TYPE)[0],
    );
  }
  // source: https://github.com/obsidianmd/obsidian-releases/blob/master/plugin-review.md#avoid-managing-references-to-custom-views
  get_view() {
    for (let leaf of this.app.workspace.getLeavesOfType(
      SMART_CONNECTIONS_VIEW_TYPE,
    )) {
      if (leaf.view instanceof SmartConnectionsView) {
        return leaf.view;
      }
    }
  }
  // open chat view
  async open_chat(retries = 0) {
    if (!this.embeddings_loaded) {
      console.log('embeddings not loaded yet');
      if (retries < 3) {
        // wait and try again
        setTimeout(() => {
          this.open_chat(retries + 1);
        }, 1000 * (retries + 1));
        return;
      }
      console.log('embeddings still not loaded, opening smart view');
      this.open_view();
      return;
    }
    this.app.workspace.detachLeavesOfType(SMART_CONNECTIONS_CHAT_VIEW_TYPE);
    await this.app.workspace.getRightLeaf(false).setViewState({
      type: SMART_CONNECTIONS_CHAT_VIEW_TYPE,
      active: true,
    });
    this.app.workspace.revealLeaf(
      this.app.workspace.getLeavesOfType(SMART_CONNECTIONS_CHAT_VIEW_TYPE)[0],
    );
  }

  // get embeddings for all files
  async get_all_embeddings() {
    // get all files in vault and filter all but markdown and canvas files
    const files = (await this.app.vault.getFiles()).filter(
      (file) =>
        file instanceof Obsidian.TFile &&
        (file.extension === 'md' || file.extension === 'canvas'),
    );
    // const files = await this.app.vault.getMarkdownFiles();
    // get open files to skip if file is currently open
    const open_files = this.app.workspace
      .getLeavesOfType('markdown')
      .map((leaf) => leaf.view.file);
    const clean_up_log = this.smart_vec_lite.clean_up_embeddings(files);
    if (this.settings.log_render) {
      this.render_log.total_files = files.length;
      this.render_log.deleted_embeddings = clean_up_log.deleted_embeddings;
      this.render_log.total_embeddings = clean_up_log.total_embeddings;
    }
    // batch embeddings
    let batch_promises = [];
    for (let i = 0; i < files.length; i++) {
      // skip if path contains a #
      if (files[i].path.indexOf('#') > -1) {
        // console.log("skipping file '"+files[i].path+"' (path contains #)");
        this.log_exclusion('path contains #');
        continue;
      }
      // skip if file already has embedding and embedding.mtime is greater than or equal to file.mtime
      if (
        this.smart_vec_lite.mtime_is_current(
          md5(files[i].path),
          files[i].stat.mtime,
        )
      ) {
        // log skipping file
        // console.log("skipping file (mtime)");
        continue;
      }
      // check if file is in failed_files
      if (this.settings.failed_files.indexOf(files[i].path) > -1) {
        // log skipping file
        // console.log("skipping previously failed file, use button in settings to retry");
        // use setTimeout to prevent multiple notices
        if (this.retry_notice_timeout) {
          clearTimeout(this.retry_notice_timeout);
          this.retry_notice_timeout = null;
        }
        // limit to one notice every 10 minutes
        if (!this.recently_sent_retry_notice) {
          new Obsidian.Notice(
            'Smart Connections: Skipping previously failed file, use button in settings to retry',
          );
          this.recently_sent_retry_notice = true;
          setTimeout(() => {
            this.recently_sent_retry_notice = false;
          }, 600000);
        }
        continue;
      }
      // skip files where path contains any exclusions
      let skip = false;
      for (let j = 0; j < this.file_exclusions.length; j++) {
        if (files[i].path.indexOf(this.file_exclusions[j]) > -1) {
          skip = true;
          this.log_exclusion(this.file_exclusions[j]);
          // break out of loop
          break;
        }
      }
      if (skip) {
        continue; // to next file
      }
      // check if file is open
      if (open_files.indexOf(files[i]) > -1) {
        // console.log("skipping file (open)");
        continue;
      }
      try {
        // push promise to batch_promises
        batch_promises.push(this.get_file_embeddings(files[i], false));
      } catch (error) {
        console.log(error);
      }
      // if batch_promises length is 10
      if (batch_promises.length > 3) {
        // wait for all promises to resolve
        await Promise.all(batch_promises);
        // clear batch_promises
        batch_promises = [];
      }

      // save embeddings JSON to file every 100 files to save progress on bulk embedding
      if (i > 0 && i % 100 === 0) {
        await this.save_embeddings_to_file();
      }
    }
    // wait for all promises to resolve
    await Promise.all(batch_promises);
    // write embeddings JSON to file
    await this.save_embeddings_to_file();
    // if render_log.failed_embeddings then update failed_embeddings.txt
    if (this.render_log.failed_embeddings.length > 0) {
      await this.save_failed_embeddings();
    }
  }

  async save_embeddings_to_file(force = false) {
    if (!this.has_new_embeddings) {
      return;
    }
    // console.log("new embeddings, saving to file");
    if (!force) {
      // prevent excessive writes to embeddings file by waiting 1 minute before writing
      if (this.save_timeout) {
        clearTimeout(this.save_timeout);
        this.save_timeout = null;
      }
      this.save_timeout = setTimeout(() => {
        // console.log("writing embeddings to file");
        this.save_embeddings_to_file(true);
        // clear timeout
        if (this.save_timeout) {
          clearTimeout(this.save_timeout);
          this.save_timeout = null;
        }
      }, 30000);
      console.log('scheduled save');
      return;
    }

    try {
      // use smart_vec_lite
      await this.smart_vec_lite.save();
      this.has_new_embeddings = false;
    } catch (error) {
      console.log(error);
      new Obsidian.Notice('Smart Connections: ' + error.message);
    }
  }
  // save failed embeddings to file from render_log.failed_embeddings
  async save_failed_embeddings() {
    // write failed_embeddings to file one line per failed embedding
    let failed_embeddings = [];
    // if file already exists then read it
    const failed_embeddings_file_exists = await this.app.vault.adapter.exists(
      '.smart-connections/failed-embeddings.txt',
    );
    if (failed_embeddings_file_exists) {
      failed_embeddings = await this.app.vault.adapter.read(
        '.smart-connections/failed-embeddings.txt',
      );
      // split failed_embeddings into array
      failed_embeddings = failed_embeddings.split('\r\n');
    }
    // merge failed_embeddings with render_log.failed_embeddings
    failed_embeddings = failed_embeddings.concat(
      this.render_log.failed_embeddings,
    );
    // remove duplicates
    failed_embeddings = [...new Set(failed_embeddings)];
    // sort failed_embeddings array alphabetically
    failed_embeddings.sort();
    // convert failed_embeddings array to string
    failed_embeddings = failed_embeddings.join('\r\n');
    // write failed_embeddings to file
    await this.app.vault.adapter.write(
      '.smart-connections/failed-embeddings.txt',
      failed_embeddings,
    );
    // reload failed_embeddings to prevent retrying failed files until explicitly requested
    await this.load_failed_files();
  }

  // load failed files from failed-embeddings.txt
  async load_failed_files() {
    // check if failed-embeddings.txt exists
    const failed_embeddings_file_exists = await this.app.vault.adapter.exists(
      '.smart-connections/failed-embeddings.txt',
    );
    if (!failed_embeddings_file_exists) {
      this.settings.failed_files = [];
      console.log('No failed files.');
      return;
    }
    // read failed-embeddings.txt
    const failed_embeddings = await this.app.vault.adapter.read(
      '.smart-connections/failed-embeddings.txt',
    );
    // split failed_embeddings into array and remove empty lines
    const failed_embeddings_array = failed_embeddings.split('\r\n');
    // split at '#' and reduce into unique file paths
    const failed_files = failed_embeddings_array
      .map((embedding) => embedding.split('#')[0])
      .reduce(
        (unique, item) => (unique.includes(item) ? unique : [...unique, item]),
        [],
      );
    // return failed_files
    this.settings.failed_files = failed_files;
    // console.log(failed_files);
  }
  // retry failed embeddings
  async retry_failed_files() {
    // remove failed files from failed_files
    this.settings.failed_files = [];
    // if failed-embeddings.txt exists then delete it
    const failed_embeddings_file_exists = await this.app.vault.adapter.exists(
      '.smart-connections/failed-embeddings.txt',
    );
    if (failed_embeddings_file_exists) {
      await this.app.vault.adapter.remove(
        '.smart-connections/failed-embeddings.txt',
      );
    }
    // run get all embeddings
    await this.get_all_embeddings();
  }

  // add .smart-connections to .gitignore to prevent issues with large, frequently updated embeddings file(s)
  async add_to_gitignore() {
    if (!(await this.app.vault.adapter.exists('.gitignore'))) {
      return; // if .gitignore doesn't exist then don't add .smart-connections to .gitignore
    }
    let gitignore_file = await this.app.vault.adapter.read('.gitignore');
    // if .smart-connections not in .gitignore
    if (gitignore_file.indexOf('.smart-connections') < 0) {
      // add .smart-connections to .gitignore
      let add_to_gitignore =
        '\n\n# Ignore Smart Connections folder because embeddings file is large and updated frequently';
      add_to_gitignore += '\n.smart-connections';
      await this.app.vault.adapter.write(
        '.gitignore',
        gitignore_file + add_to_gitignore,
      );
      console.log('added .smart-connections to .gitignore');
    }
  }

  // force refresh embeddings file but first rename existing embeddings file to .smart-connections/embeddings-YYYY-MM-DD.json
  async force_refresh_embeddings_file() {
    new Obsidian.Notice(
      'Smart Connections: embeddings file Force Refreshed, making new connections...',
    );
    // force refresh
    await this.smart_vec_lite.force_refresh();
    // trigger making new connections
    await this.get_all_embeddings();
    this.output_render_log();
    new Obsidian.Notice(
      'Smart Connections: embeddings file Force Refreshed, new connections made.',
    );
  }

  // get embeddings for embed_input
  async get_file_embeddings(curr_file, save = true) {
    // let batch_promises = [];
    let req_batch = [];
    let blocks = [];
    // initiate curr_file_key from md5(curr_file.path)
    const curr_file_key = md5(curr_file.path);
    // intiate file_file_embed_input by removing .md and converting file path to breadcrumbs (" > ")
    let file_embed_input = curr_file.path.replace('.md', '');
    file_embed_input = file_embed_input.replace(/\//g, ' > ');
    // embed on file.name/title only if path_only path matcher specified in settings
    let path_only = false;
    for (let j = 0; j < this.path_only.length; j++) {
      if (curr_file.path.indexOf(this.path_only[j]) > -1) {
        path_only = true;
        console.log('title only file with matcher: ' + this.path_only[j]);
        // break out of loop
        break;
      }
    }
    // return early if path_only
    if (path_only) {
      req_batch.push([
        curr_file_key,
        file_embed_input,
        {
          mtime: curr_file.stat.mtime,
          path: curr_file.path,
        },
      ]);
      await this.get_embeddings_batch(req_batch);
      return;
    }
    /**
     * BEGIN Canvas file type Embedding
     */
    if (curr_file.extension === 'canvas') {
      // get file contents and parse as JSON
      const canvas_contents = await this.app.vault.cachedRead(curr_file);
      if (
        typeof canvas_contents === 'string' &&
        canvas_contents.indexOf('nodes') > -1
      ) {
        const canvas_json = JSON.parse(canvas_contents);
        // for each object in nodes array
        for (let j = 0; j < canvas_json.nodes.length; j++) {
          // if object has text property
          if (canvas_json.nodes[j].text) {
            // add to file_embed_input
            file_embed_input += '\n' + canvas_json.nodes[j].text;
          }
          // if object has file property
          if (canvas_json.nodes[j].file) {
            // add to file_embed_input
            file_embed_input += '\nLink: ' + canvas_json.nodes[j].file;
          }
        }
      }
      // console.log(file_embed_input);
      req_batch.push([
        curr_file_key,
        file_embed_input,
        {
          mtime: curr_file.stat.mtime,
          path: curr_file.path,
        },
      ]);
      await this.get_embeddings_batch(req_batch);
      return;
    }

    /**
     * BEGIN Block "section" embedding
     */
    // get file contents
    const note_contents = await this.app.vault.cachedRead(curr_file);
    let processed_since_last_save = 0;
    const note_sections = this.block_parser(note_contents, curr_file.path);
    // console.log(note_sections);
    // if note has more than one section (if only one then its same as full-content)
    if (note_sections.length > 1) {
      // for each section in file
      //console.log("Sections: " + note_sections.length);
      for (let j = 0; j < note_sections.length; j++) {
        // get embed_input for block
        const block_embed_input = note_sections[j].text;
        // console.log(note_sections[j].path);
        // get block key from block.path (contains both file.path and header path)
        const block_key = md5(note_sections[j].path);
        blocks.push(block_key);
        // skip if length of block_embed_input same as length of embeddings[block_key].meta.size
        // TODO consider rounding to nearest 10 or 100 for fuzzy matching
        if (
          this.smart_vec_lite.get_size(block_key) === block_embed_input.length
        ) {
          // log skipping file
          // console.log("skipping block (len)");
          continue;
        }
        // add hash to blocks to prevent empty blocks triggering full-file embedding
        // skip if embeddings key already exists and block mtime is greater than or equal to file mtime
        if (
          this.smart_vec_lite.mtime_is_current(block_key, curr_file.stat.mtime)
        ) {
          // log skipping file
          // console.log("skipping block (mtime)");
          continue;
        }
        // skip if hash is present in embeddings and hash of block_embed_input is equal to hash in embeddings
        const block_hash = md5(block_embed_input.trim());
        if (this.smart_vec_lite.get_hash(block_key) === block_hash) {
          // log skipping file
          // console.log("skipping block (hash)");
          continue;
        }

        // create req_batch for batching requests
        req_batch.push([
          block_key,
          block_embed_input,
          {
            // oldmtime: curr_file.stat.mtime,
            // get current datetime as unix timestamp
            mtime: Date.now(),
            hash: block_hash,
            parent: curr_file_key,
            path: note_sections[j].path,
            size: block_embed_input.length,
          },
        ]);
        if (req_batch.length > 9) {
          // add batch to batch_promises
          await this.get_embeddings_batch(req_batch);
          processed_since_last_save += req_batch.length;
          // log embedding
          // console.log("embedding: " + curr_file.path);
          if (processed_since_last_save >= 30) {
            // write embeddings JSON to file
            await this.save_embeddings_to_file();
            // reset processed_since_last_save
            processed_since_last_save = 0;
          }
          // reset req_batch
          req_batch = [];
        }
      }
    }
    // if req_batch is not empty
    if (req_batch.length > 0) {
      // process remaining req_batch
      await this.get_embeddings_batch(req_batch);
      req_batch = [];
      processed_since_last_save += req_batch.length;
    }

    /**
     * BEGIN File "full note" embedding
     */

    // if file length is less than ~8000 tokens use full file contents
    // else if file length is greater than 8000 tokens build file_embed_input from file headings
    file_embed_input += `:\n`;
    /**
     * TODO: improve/refactor the following "large file reduce to headings" logic
     */
    if (note_contents.length < MAX_EMBED_STRING_LENGTH) {
      file_embed_input += note_contents;
    } else {
      const note_meta_cache = this.app.metadataCache.getFileCache(curr_file);
      // for each heading in file
      if (typeof note_meta_cache.headings === 'undefined') {
        // console.log("no headings found, using first chunk of file instead");
        file_embed_input += note_contents.substring(0, MAX_EMBED_STRING_LENGTH);
      } else {
        let note_headings = '';
        for (let j = 0; j < note_meta_cache.headings.length; j++) {
          // get heading level
          const heading_level = note_meta_cache.headings[j].level;
          // get heading text
          const heading_text = note_meta_cache.headings[j].heading;
          // build markdown heading
          let md_heading = '';
          for (let k = 0; k < heading_level; k++) {
            md_heading += '#';
          }
          // add heading to note_headings
          note_headings += `${md_heading} ${heading_text}\n`;
        }
        //console.log(note_headings);
        file_embed_input += note_headings;
        if (file_embed_input.length > MAX_EMBED_STRING_LENGTH) {
          file_embed_input = file_embed_input.substring(
            0,
            MAX_EMBED_STRING_LENGTH,
          );
        }
      }
    }
    // skip embedding full file if blocks is not empty and all hashes are present in embeddings
    // better than hashing file_embed_input because more resilient to inconsequential changes (whitespace between headings)
    const file_hash = md5(file_embed_input.trim());
    const existing_hash = this.smart_vec_lite.get_hash(curr_file_key);
    if (existing_hash && file_hash === existing_hash) {
      // console.log("skipping file (hash): " + curr_file.path);
      this.update_render_log(blocks, file_embed_input);
      return;
    }

    // if not already skipping and blocks are present
    const existing_blocks = this.smart_vec_lite.get_children(curr_file_key);
    let existing_has_all_blocks = true;
    if (
      existing_blocks &&
      Array.isArray(existing_blocks) &&
      blocks.length > 0
    ) {
      // if all blocks are in existing_blocks then skip (allows deletion of small blocks without triggering full file embedding)
      for (let j = 0; j < blocks.length; j++) {
        if (existing_blocks.indexOf(blocks[j]) === -1) {
          existing_has_all_blocks = false;
          break;
        }
      }
    }
    // if existing has all blocks then check file size for delta
    if (existing_has_all_blocks) {
      // get current note file size
      const curr_file_size = curr_file.stat.size;
      // get file size from embeddings
      const prev_file_size = this.smart_vec_lite.get_size(curr_file_key);
      if (prev_file_size) {
        // if curr file size is less than 10% different from prev file size
        const file_delta_pct = Math.round(
          (Math.abs(curr_file_size - prev_file_size) / curr_file_size) * 100,
        );
        if (file_delta_pct < 10) {
          // skip embedding
          // console.log("skipping file (size) " + curr_file.path);
          this.render_log.skipped_low_delta[curr_file.name] =
            file_delta_pct + '%';
          this.update_render_log(blocks, file_embed_input);
          return;
        }
      }
    }
    let meta = {
      mtime: curr_file.stat.mtime,
      hash: file_hash,
      path: curr_file.path,
      size: curr_file.stat.size,
      children: blocks,
    };
    // batch_promises.push(this.get_embeddings(curr_file_key, file_embed_input, meta));
    req_batch.push([curr_file_key, file_embed_input, meta]);
    // send batch request
    await this.get_embeddings_batch(req_batch);

    // log embedding
    // console.log("embedding: " + curr_file.path);
    if (save) {
      // write embeddings JSON to file
      await this.save_embeddings_to_file();
    }
  }

  update_render_log(blocks, file_embed_input) {
    if (blocks.length > 0) {
      // multiply by 2 because implies we saved token spending on blocks(sections), too
      this.render_log.tokens_saved_by_cache += file_embed_input.length / 2;
    } else {
      // calc tokens saved by cache: divide by 4 for token estimate
      this.render_log.tokens_saved_by_cache += file_embed_input.length / 4;
    }
  }

  async get_embeddings_batch(req_batch) {
    console.log('get_embeddings_batch');
    // if req_batch is empty then return
    if (req_batch.length === 0) return;
    // create arrary of embed_inputs from req_batch[i][1]
    const embed_inputs = req_batch.map((req) => req[1]);
    // request embeddings from embed_inputs
    const requestResults = await this.request_embedding_from_input(
      embed_inputs,
    );
    // if requestResults is null then return
    if (!requestResults) {
      console.log('failed embedding batch');
      // log failed file names to render_log
      this.render_log.failed_embeddings = [
        ...this.render_log.failed_embeddings,
        ...req_batch.map((req) => req[2].path),
      ];
      return;
    }
    // if requestResults is not null
    if (requestResults) {
      this.has_new_embeddings = true;
      // add embedding key to render_log
      if (this.settings.log_render) {
        if (this.settings.log_render_files) {
          this.render_log.files = [
            ...this.render_log.files,
            ...req_batch.map((req) => req[2].path),
          ];
        }
        this.render_log.new_embeddings += req_batch.length;
        // add token usage to render_log
        this.render_log.token_usage += requestResults.usage.total_tokens;
      }
      // console.log(requestResults.data.length);
      // loop through requestResults.data
      for (let i = 0; i < requestResults.data.length; i++) {
        const vec = requestResults.data[i].embedding;
        const index = requestResults.data[i].index;
        if (vec) {
          const key = req_batch[index][0];
          const meta = req_batch[index][2];
          this.smart_vec_lite.save_embedding(key, vec, meta);
        }
      }
    }
  }

  async request_embedding_from_input(embed_input, retries = 0) {
    // (FOR TESTING) test fail process by forcing fail
    // return null;
    // check if embed_input is a string
    // if(typeof embed_input !== "string") {
    //   console.log("embed_input is not a string");
    //   return null;
    // }
    // check if embed_input is empty
    if (embed_input.length === 0) {
      console.log('embed_input is empty');
      return null;
    }
    const usedParams = {
      model: 'text-embedding-ada-002',
      input: embed_input,
    };
    // console.log(this.settings.api_key);
    const reqParams = {
      url: `https://api.openai.com/v1/embeddings`,
      method: 'POST',
      body: JSON.stringify(usedParams),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.settings.api_key}`,
      },
    };
    let resp;
    try {
      resp = await (0, Obsidian.request)(reqParams);
      return JSON.parse(resp);
    } catch (error) {
      // retry request if error is 429
      if (error.status === 429 && retries < 3) {
        retries++;
        // exponential backoff
        const backoff = Math.pow(retries, 2);
        console.log(`retrying request (429) in ${backoff} seconds...`);
        await new Promise((r) => setTimeout(r, 1000 * backoff));
        return await this.request_embedding_from_input(embed_input, retries);
      }
      // log full error to console
      console.log(resp);
      // console.log("first line of embed: " + embed_input.substring(0, embed_input.indexOf("\n")));
      // console.log("embed input length: "+ embed_input.length);
      // if(Array.isArray(embed_input)) {
      //   console.log(embed_input.map((input) => input.length));
      // }
      // console.log("erroneous embed input: " + embed_input);
      console.log(error);
      // console.log(usedParams);
      // console.log(usedParams.input.length);
      return null;
    }
  }
  async test_api_key() {
    const embed_input = 'This is a test of the OpenAI API.';
    const resp = await this.request_embedding_from_input(embed_input);
    if (resp && resp.usage) {
      console.log('API key is valid');
      return true;
    } else {
      console.log('API key is invalid');
      return false;
    }
  }

  output_render_log() {
    // if settings.log_render is true
    if (this.settings.log_render) {
      if (this.render_log.new_embeddings === 0) {
        return;
      } else {
        // pretty print this.render_log to console
        console.log(JSON.stringify(this.render_log, null, 2));
      }
    }

    // clear render_log
    this.render_log = {};
    this.render_log.deleted_embeddings = 0;
    this.render_log.exclusions_logs = {};
    this.render_log.failed_embeddings = [];
    this.render_log.files = [];
    this.render_log.new_embeddings = 0;
    this.render_log.skipped_low_delta = {};
    this.render_log.token_usage = 0;
    this.render_log.tokens_saved_by_cache = 0;
  }

  // find connections by most similar to current note by cosine similarity
  async find_note_connections(current_note = null) {
    // md5 of current note path
    const curr_key = md5(current_note.path);
    // if in this.nearest_cache then set to nearest
    // else get nearest
    let nearest = [];
    if (this.nearest_cache[curr_key]) {
      nearest = this.nearest_cache[curr_key];
      // console.log("nearest from cache");
    } else {
      // skip files where path contains any exclusions
      for (let j = 0; j < this.file_exclusions.length; j++) {
        if (current_note.path.indexOf(this.file_exclusions[j]) > -1) {
          this.log_exclusion(this.file_exclusions[j]);
          // break out of loop and finish here
          return 'excluded';
        }
      }
      // get all embeddings
      // await this.get_all_embeddings();
      // wrap get all in setTimeout to allow for UI to update
      setTimeout(() => {
        this.get_all_embeddings();
      }, 3000);
      // get from cache if mtime is same and values are not empty
      if (
        this.smart_vec_lite.mtime_is_current(curr_key, current_note.stat.mtime)
      ) {
        // skipping get file embeddings because nothing has changed
        // console.log("find_note_connections - skipping file (mtime)");
      } else {
        // get file embeddings
        await this.get_file_embeddings(current_note);
      }
      // get current note embedding vector
      const vec = this.smart_vec_lite.get_vec(curr_key);
      if (!vec) {
        return 'Error getting embeddings for: ' + current_note.path;
      }

      // compute cosine similarity between current note and all other notes via embeddings
      nearest = this.smart_vec_lite.nearest(vec, {
        skip_key: curr_key,
        skip_sections: this.settings.skip_sections,
      });

      // save to this.nearest_cache
      this.nearest_cache[curr_key] = nearest;
    }

    // return array sorted by cosine similarity
    return nearest;
  }

  // create render_log object of exlusions with number of times skipped as value
  log_exclusion(exclusion) {
    // increment render_log for skipped file
    this.render_log.exclusions_logs[exclusion] =
      (this.render_log.exclusions_logs[exclusion] || 0) + 1;
  }

  block_parser(markdown, file_path) {
    // if this.settings.skip_sections is true then return empty array
    if (this.settings.skip_sections) {
      return [];
    }
    // split the markdown into lines
    const lines = markdown.split('\n');
    // initialize the blocks array
    let blocks = [];
    // current headers array
    let currentHeaders = [];
    // remove .md file extension and convert file_path to breadcrumb formatting
    const file_breadcrumbs = file_path.replace('.md', '').replace(/\//g, ' > ');
    // initialize the block string
    let block = '';
    let block_headings = '';
    let block_path = file_path;

    let last_heading_line = 0;
    let i = 0;
    let block_headings_list = [];
    // loop through the lines
    for (i = 0; i < lines.length; i++) {
      // get the line
      const line = lines[i];
      // if line does not start with #
      // or if line starts with # and second character is a word or number indicating a "tag"
      // then add to block
      if (!line.startsWith('#') || ['#', ' '].indexOf(line[1]) < 0) {
        // skip if line is empty
        if (line === '') continue;
        // skip if line is empty bullet or checkbox
        if (['- ', '- [ ] '].indexOf(line) > -1) continue;
        // if currentHeaders is empty skip (only blocks with headers, otherwise block.path conflicts with file.path)
        if (currentHeaders.length === 0) continue;
        // add line to block
        block += '\n' + line;
        continue;
      }
      /**
       * BEGIN Heading parsing
       * - likely a heading if made it this far
       */
      last_heading_line = i;
      // push the current block to the blocks array unless last line was a also a header
      if (
        i > 0 &&
        last_heading_line !== i - 1 &&
        block.indexOf('\n') > -1 &&
        this.validate_headings(block_headings)
      ) {
        output_block();
      }
      // get the header level
      const level = line.split('#').length - 1;
      // remove any headers from the current headers array that are higher than the current header level
      currentHeaders = currentHeaders.filter((header) => header.level < level);
      // add header and level to current headers array
      // trim the header to remove "#" and any trailing spaces
      currentHeaders.push({
        header: line.replace(/#/g, '').trim(),
        level: level,
      });
      // initialize the block breadcrumbs with file.path the current headers
      block = file_breadcrumbs;
      block += ': ' + currentHeaders.map((header) => header.header).join(' > ');
      block_headings =
        '#' + currentHeaders.map((header) => header.header).join('#');
      // if block_headings is already in block_headings_list then add a number to the end
      if (block_headings_list.indexOf(block_headings) > -1) {
        let count = 1;
        while (
          block_headings_list.indexOf(`${block_headings}{${count}}`) > -1
        ) {
          count++;
        }
        block_headings = `${block_headings}{${count}}`;
      }
      block_headings_list.push(block_headings);
      block_path = file_path + block_headings;
    }
    // handle remaining after loop
    if (
      last_heading_line !== i - 1 &&
      block.indexOf('\n') > -1 &&
      this.validate_headings(block_headings)
    )
      output_block();
    // remove any blocks that are too short (length < 50)
    blocks = blocks.filter((b) => b.length > 50);
    // console.log(blocks);
    // return the blocks array
    return blocks;

    function output_block() {
      // breadcrumbs length (first line of block)
      const breadcrumbs_length = block.indexOf('\n') + 1;
      const block_length = block.length - breadcrumbs_length;
      // trim block to max length
      if (block.length > MAX_EMBED_STRING_LENGTH) {
        block = block.substring(0, MAX_EMBED_STRING_LENGTH);
      }
      blocks.push({
        text: block.trim(),
        path: block_path,
        length: block_length,
      });
    }
  }
  // reverse-retrieve block given path
  async block_retriever(path, limits = {}) {
    limits = {
      lines: null,
      chars_per_line: null,
      max_chars: null,
      ...limits,
    };
    // return if no # in path
    if (path.indexOf('#') < 0) {
      console.log('not a block path: ' + path);
      return false;
    }
    let block = [];
    let block_headings = path.split('#').slice(1);
    // if path ends with number in curly braces
    let heading_occurrence = 0;
    if (block_headings[block_headings.length - 1].indexOf('{') > -1) {
      // get the occurrence number
      heading_occurrence = parseInt(
        block_headings[block_headings.length - 1]
          .split('{')[1]
          .replace('}', ''),
      );
      // remove the occurrence from the last heading
      block_headings[block_headings.length - 1] =
        block_headings[block_headings.length - 1].split('{')[0];
    }
    let currentHeaders = [];
    let occurrence_count = 0;
    let begin_line = 0;
    let i = 0;
    // get file path from path
    const file_path = path.split('#')[0];
    // get file
    const file = this.app.vault.getAbstractFileByPath(file_path);
    if (!(file instanceof Obsidian.TFile)) {
      console.log('not a file: ' + file_path);
      return false;
    }
    // get file contents
    const file_contents = await this.app.vault.cachedRead(file);
    // split the file contents into lines
    const lines = file_contents.split('\n');
    // loop through the lines
    let is_code = false;
    for (i = 0; i < lines.length; i++) {
      // get the line
      const line = lines[i];
      // if line begins with three backticks then toggle is_code
      if (line.indexOf('```') === 0) {
        is_code = !is_code;
      }
      // if is_code is true then add line with preceding tab and continue
      if (is_code) {
        continue;
      }
      // skip if line is empty bullet or checkbox
      if (['- ', '- [ ] '].indexOf(line) > -1) continue;
      // if line does not start with #
      // or if line starts with # and second character is a word or number indicating a "tag"
      // then continue to next line
      if (!line.startsWith('#') || ['#', ' '].indexOf(line[1]) < 0) {
        continue;
      }
      /**
       * BEGIN Heading parsing
       * - likely a heading if made it this far
       */
      // get the heading text
      const heading_text = line.replace(/#/g, '').trim();
      // continue if heading text is not in block_headings
      const heading_index = block_headings.indexOf(heading_text);
      if (heading_index < 0) continue;
      // if currentHeaders.length !== heading_index then we have a mismatch
      if (currentHeaders.length !== heading_index) continue;
      // push the heading text to the currentHeaders array
      currentHeaders.push(heading_text);
      // if currentHeaders.length === block_headings.length then we have a match
      if (currentHeaders.length === block_headings.length) {
        // if heading_occurrence is defined then increment occurrence_count
        if (heading_occurrence === 0) {
          // set begin_line to i + 1
          begin_line = i + 1;
          break; // break out of loop
        }
        // if occurrence_count !== heading_occurrence then continue
        if (occurrence_count === heading_occurrence) {
          begin_line = i + 1;
          break; // break out of loop
        }
        occurrence_count++;
        // reset currentHeaders
        currentHeaders.pop();
        continue;
      }
    }
    // if no begin_line then return false
    if (begin_line === 0) return false;
    // iterate through lines starting at begin_line
    is_code = false;
    // character accumulator
    let char_count = 0;
    for (i = begin_line; i < lines.length; i++) {
      if (typeof line_limit === 'number' && block.length > line_limit) {
        block.push('...');
        break; // ends when line_limit is reached
      }
      let line = lines[i];
      if (line.indexOf('#') === 0 && ['#', ' '].indexOf(line[1]) !== -1) {
        break; // ends when encountering next header
      }
      // DEPRECATED: should be handled by new_line+char_count check (happens in previous iteration)
      // if char_count is greater than limit.max_chars, skip
      if (limits.max_chars && char_count > limits.max_chars) {
        block.push('...');
        break;
      }
      // if new_line + char_count is greater than limit.max_chars, skip
      if (limits.max_chars && line.length + char_count > limits.max_chars) {
        const max_new_chars = limits.max_chars - char_count;
        line = line.slice(0, max_new_chars) + '...';
        break;
      }
      // validate/format
      // if line is empty, skip
      if (line.length === 0) continue;
      // limit length of line to N characters
      if (limits.chars_per_line && line.length > limits.chars_per_line) {
        line = line.slice(0, limits.chars_per_line) + '...';
      }
      // if line is a code block, skip
      if (line.startsWith('```')) {
        is_code = !is_code;
        continue;
      }
      if (is_code) {
        // add tab to beginning of line
        line = '\t' + line;
      }
      // add line to block
      block.push(line);
      // increment char_count
      char_count += line.length;
    }
    // close code block if open
    if (is_code) {
      block.push('```');
    }
    return block.join('\n').trim();
  }

  // retrieve a file from the vault
  async file_retriever(link, limits = {}) {
    limits = {
      lines: null,
      max_chars: null,
      chars_per_line: null,
      ...limits,
    };
    const this_file = this.app.vault.getAbstractFileByPath(link);
    // if file is not found, skip
    if (!(this_file instanceof Obsidian.TAbstractFile)) return false;
    // use cachedRead to get the first 10 lines of the file
    const file_content = await this.app.vault.cachedRead(this_file);
    const file_lines = file_content.split('\n');
    let first_ten_lines = [];
    let is_code = false;
    let char_accum = 0;
    const line_limit = limits.lines || file_lines.length;
    for (let i = 0; first_ten_lines.length < line_limit; i++) {
      let line = file_lines[i];
      // if line is undefined, break
      if (typeof line === 'undefined') break;
      // if line is empty, skip
      if (line.length === 0) continue;
      // limit length of line to N characters
      if (limits.chars_per_line && line.length > limits.chars_per_line) {
        line = line.slice(0, limits.chars_per_line) + '...';
      }
      // if line is "---", skip
      if (line === '---') continue;
      // skip if line is empty bullet or checkbox
      if (['- ', '- [ ] '].indexOf(line) > -1) continue;
      // if line is a code block, skip
      if (line.indexOf('```') === 0) {
        is_code = !is_code;
        continue;
      }
      // if char_accum is greater than limit.max_chars, skip
      if (limits.max_chars && char_accum > limits.max_chars) {
        first_ten_lines.push('...');
        break;
      }
      if (is_code) {
        // if is code, add tab to beginning of line
        line = '\t' + line;
      }
      // if line is a heading
      if (line_is_heading(line)) {
        // look at last line in first_ten_lines to see if it is a heading
        // note: uses last in first_ten_lines, instead of look ahead in file_lines, because..
        // ...next line may be excluded from first_ten_lines by previous if statements
        if (
          first_ten_lines.length > 0 &&
          line_is_heading(first_ten_lines[first_ten_lines.length - 1])
        ) {
          // if last line is a heading, remove it
          first_ten_lines.pop();
        }
      }
      // add line to first_ten_lines
      first_ten_lines.push(line);
      // increment char_accum
      char_accum += line.length;
    }
    // for each line in first_ten_lines, apply view-specific formatting
    for (let i = 0; i < first_ten_lines.length; i++) {
      // if line is a heading
      if (line_is_heading(first_ten_lines[i])) {
        // if this is the last line in first_ten_lines
        if (i === first_ten_lines.length - 1) {
          // remove the last line if it is a heading
          first_ten_lines.pop();
          break;
        }
        // remove heading syntax to improve readability in small space
        first_ten_lines[i] = first_ten_lines[i].replace(/#+/, '');
        first_ten_lines[i] = `\n${first_ten_lines[i]}:`;
      }
    }
    // join first ten lines into string
    first_ten_lines = first_ten_lines.join('\n');
    return first_ten_lines;
  }

  // iterate through blocks and skip if block_headings contains this.header_exclusions
  validate_headings(block_headings) {
    let valid = true;
    if (this.header_exclusions.length > 0) {
      for (let k = 0; k < this.header_exclusions.length; k++) {
        if (block_headings.indexOf(this.header_exclusions[k]) > -1) {
          valid = false;
          this.log_exclusion('heading: ' + this.header_exclusions[k]);
          break;
        }
      }
    }
    return valid;
  }
  // render "Smart Connections" text fixed in the bottom right corner
  render_brand(container, location = 'default') {
    // if location is all then get Object.keys(this.sc_branding) and call this function for each
    if (container === 'all') {
      const locations = Object.keys(this.sc_branding);
      for (let i = 0; i < locations.length; i++) {
        this.render_brand(this.sc_branding[locations[i]], locations[i]);
      }
      return;
    }
    // brand container
    this.sc_branding[location] = container;
    // if this.sc_branding[location] contains child with class "sc-brand", remove it
    if (this.sc_branding[location].querySelector('.sc-brand')) {
      this.sc_branding[location].querySelector('.sc-brand').remove();
    }
    const brand_container = this.sc_branding[location].createEl('div', {
      cls: 'sc-brand',
    });
    // add text
    // add SVG signal icon using getIcon
    Obsidian.setIcon(brand_container, 'smart-connections');
    const brand_p = brand_container.createEl('p');
    let text = 'Smart Connections';
    let attr = {};
    // if update available, change text to "Update Available"
    if (this.update_available) {
      text = 'Update Available';
      attr = {
        style: 'font-weight: 700;',
      };
    }
    brand_p.createEl('a', {
      cls: '',
      text: text,
      href: 'https://github.com/brianpetro/obsidian-smart-connections/discussions',
      target: '_blank',
      attr: attr,
    });
  }

  // create list of nearest notes
  async update_results(container, nearest) {
    let list;
    // check if list exists
    if (
      container.children.length > 1 &&
      container.children[1].classList.contains('sc-list')
    ) {
      list = container.children[1];
    }
    // if list exists, empty it
    if (list) {
      list.empty();
    } else {
      // create list element
      list = container.createEl('div', { cls: 'sc-list' });
    }
    let search_result_class = 'search-result';
    // if settings expanded_view is false, add sc-collapsed class
    if (!this.settings.expanded_view) search_result_class += ' sc-collapsed';

    // TODO: add option to group nearest by file
    if (!this.settings.group_nearest_by_file) {
      // for each nearest note
      for (let i = 0; i < nearest.length; i++) {
        /**
         * BEGIN EXTERNAL LINK LOGIC
         * if link is an object, it indicates external link
         */
        if (typeof nearest[i].link === 'object') {
          const item = list.createEl('div', { cls: 'search-result' });
          const link = item.createEl('a', {
            cls: 'search-result-file-title is-clickable',
            href: nearest[i].link.path,
            title: nearest[i].link.title,
          });
          link.innerHTML = this.render_external_link_elm(nearest[i].link);
          item.setAttr('draggable', 'true');
          continue; // ends here for external links
        }
        /**
         * BEGIN INTERNAL LINK LOGIC
         * if link is a string, it indicates internal link
         */
        let file_link_text;
        const file_similarity_pct =
          Math.round(nearest[i].similarity * 100) + '%';
        if (this.settings.show_full_path) {
          const pcs = nearest[i].link.split('/');
          file_link_text = pcs[pcs.length - 1];
          const path = pcs.slice(0, pcs.length - 1).join('/');
          // file_link_text = `<small>${path} | ${file_similarity_pct}</small><br>${file_link_text}`;
          file_link_text = `<small>${file_similarity_pct} | ${path} | ${file_link_text}</small>`;
        } else {
          file_link_text =
            '<small>' +
            file_similarity_pct +
            ' | ' +
            nearest[i].link.split('/').pop() +
            '</small>';
        }
        // skip contents rendering if incompatible file type
        // ex. not markdown file or contains no '.excalidraw'
        if (!this.renderable_file_type(nearest[i].link)) {
          const item = list.createEl('div', { cls: 'search-result' });
          const link = item.createEl('a', {
            cls: 'search-result-file-title is-clickable',
            href: nearest[i].link,
          });
          link.innerHTML = file_link_text;
          // drag and drop
          item.setAttr('draggable', 'true');
          // add listeners to link
          this.add_link_listeners(link, nearest[i], item);
          continue;
        }

        // remove file extension if .md and make # into >
        file_link_text = file_link_text.replace('.md', '').replace(/#/g, ' > ');
        // create item
        const item = list.createEl('div', { cls: search_result_class });
        // create span for toggle
        const toggle = item.createEl('span', { cls: 'is-clickable' });
        // insert right triangle svg as toggle
        Obsidian.setIcon(toggle, 'right-triangle'); // must come before adding other elms to prevent overwrite
        const link = toggle.createEl('a', {
          cls: 'search-result-file-title',
          title: nearest[i].link,
        });
        link.innerHTML = file_link_text;
        // add listeners to link
        this.add_link_listeners(link, nearest[i], item);
        toggle.addEventListener('click', (event) => {
          // find parent containing search-result class
          let parent = event.target.parentElement;
          while (!parent.classList.contains('search-result')) {
            parent = parent.parentElement;
          }
          // toggle sc-collapsed class
          parent.classList.toggle('sc-collapsed');
        });
        const contents = item.createEl('ul', { cls: '' });
        const contents_container = contents.createEl('li', {
          cls: 'search-result-file-title is-clickable',
          title: nearest[i].link,
        });
        if (nearest[i].link.indexOf('#') > -1) {
          // is block
          Obsidian.MarkdownRenderer.renderMarkdown(
            await this.block_retriever(nearest[i].link, {
              lines: 10,
              max_chars: 1000,
            }),
            contents_container,
            nearest[i].link,
            new Obsidian.Component(),
          );
        } else {
          // is file
          const first_ten_lines = await this.file_retriever(nearest[i].link, {
            lines: 10,
            max_chars: 1000,
          });
          if (!first_ten_lines) continue; // skip if file is empty
          Obsidian.MarkdownRenderer.renderMarkdown(
            first_ten_lines,
            contents_container,
            nearest[i].link,
            new Obsidian.Component(),
          );
        }
        this.add_link_listeners(contents, nearest[i], item);
      }
      this.render_brand(container, 'block');
      return;
    }

    // group nearest by file
    const nearest_by_file = {};
    for (let i = 0; i < nearest.length; i++) {
      const curr = nearest[i];
      const link = curr.link;
      // skip if link is an object (indicates external logic)
      if (typeof link === 'object') {
        nearest_by_file[link.path] = [curr];
        continue;
      }
      if (link.indexOf('#') > -1) {
        const file_path = link.split('#')[0];
        if (!nearest_by_file[file_path]) {
          nearest_by_file[file_path] = [];
        }
        nearest_by_file[file_path].push(nearest[i]);
      } else {
        if (!nearest_by_file[link]) {
          nearest_by_file[link] = [];
        }
        // always add to front of array
        nearest_by_file[link].unshift(nearest[i]);
      }
    }
    // for each file
    const keys = Object.keys(nearest_by_file);
    for (let i = 0; i < keys.length; i++) {
      const file = nearest_by_file[keys[i]];
      /**
       * Begin external link handling
       */
      // if link is an object (indicates v2 logic)
      if (typeof file[0].link === 'object') {
        const curr = file[0];
        const meta = curr.link;
        if (meta.path.startsWith('http')) {
          const item = list.createEl('div', { cls: 'search-result' });
          const link = item.createEl('a', {
            cls: 'search-result-file-title is-clickable',
            href: meta.path,
            title: meta.title,
          });
          link.innerHTML = this.render_external_link_elm(meta);
          item.setAttr('draggable', 'true');
          continue; // ends here for external links
        }
      }
      /**
       * Handles Internal
       */
      let file_link_text;
      const file_similarity_pct = Math.round(file[0].similarity * 100) + '%';
      if (this.settings.show_full_path) {
        const pcs = file[0].link.split('/');
        file_link_text = pcs[pcs.length - 1];
        const path = pcs.slice(0, pcs.length - 1).join('/');
        file_link_text = `<small>${path} | ${file_similarity_pct}</small><br>${file_link_text}`;
      } else {
        file_link_text = file[0].link.split('/').pop();
        // add similarity percentage
        file_link_text += ' | ' + file_similarity_pct;
      }

      // skip contents rendering if incompatible file type
      // ex. not markdown or contains '.excalidraw'
      if (!this.renderable_file_type(file[0].link)) {
        const item = list.createEl('div', { cls: 'search-result' });
        const file_link = item.createEl('a', {
          cls: 'search-result-file-title is-clickable',
          title: file[0].link,
        });
        file_link.innerHTML = file_link_text;
        // add link listeners to file link
        this.add_link_listeners(file_link, file[0], item);
        continue;
      }

      // remove file extension if .md
      file_link_text = file_link_text.replace('.md', '').replace(/#/g, ' > ');
      const item = list.createEl('div', { cls: search_result_class });
      const toggle = item.createEl('span', { cls: 'is-clickable' });
      // insert right triangle svg icon as toggle button in span
      Obsidian.setIcon(toggle, 'right-triangle'); // must come before adding other elms else overwrites
      const file_link = toggle.createEl('a', {
        cls: 'search-result-file-title',
        title: file[0].link,
      });
      file_link.innerHTML = file_link_text;
      // add link listeners to file link
      this.add_link_listeners(file_link, file[0], toggle);
      toggle.addEventListener('click', (event) => {
        // find parent containing class search-result
        let parent = event.target;
        while (!parent.classList.contains('search-result')) {
          parent = parent.parentElement;
        }
        parent.classList.toggle('sc-collapsed');
        // TODO: if block container is empty, render markdown from block retriever
      });
      const file_link_list = item.createEl('ul');
      // for each link in file
      for (let j = 0; j < file.length; j++) {
        // if is a block (has # in link)
        if (file[j].link.indexOf('#') > -1) {
          const block = file[j];
          const block_link = file_link_list.createEl('li', {
            cls: 'search-result-file-title is-clickable',
            title: block.link,
          });
          // skip block context if file.length === 1 because already added
          if (file.length > 1) {
            const block_context = this.render_block_context(block);
            const block_similarity_pct =
              Math.round(block.similarity * 100) + '%';
            block_link.innerHTML = `<small>${block_context} | ${block_similarity_pct}</small>`;
          }
          const block_container = block_link.createEl('div');
          // TODO: move to rendering on expanding section (toggle collapsed)
          Obsidian.MarkdownRenderer.renderMarkdown(
            await this.block_retriever(block.link, {
              lines: 10,
              max_chars: 1000,
            }),
            block_container,
            block.link,
            new Obsidian.Component(),
          );
          // add link listeners to block link
          this.add_link_listeners(block_link, block, file_link_list);
        } else {
          // get first ten lines of file
          const file_link_list = item.createEl('ul');
          const block_link = file_link_list.createEl('li', {
            cls: 'search-result-file-title is-clickable',
            title: file[0].link,
          });
          const block_container = block_link.createEl('div');
          let first_ten_lines = await this.file_retriever(file[0].link, {
            lines: 10,
            max_chars: 1000,
          });
          if (!first_ten_lines) continue; // if file not found, skip
          Obsidian.MarkdownRenderer.renderMarkdown(
            first_ten_lines,
            block_container,
            file[0].link,
            new Obsidian.Component(),
          );
          this.add_link_listeners(block_link, file[0], file_link_list);
        }
      }
    }
    this.render_brand(container, 'file');
  }

  add_link_listeners(item, curr, list) {
    item.addEventListener('click', async (event) => {
      await this.open_note(curr, event);
    });
    // drag-on
    // currently only works with full-file links
    item.setAttr('draggable', 'true');
    item.addEventListener('dragstart', (event) => {
      const dragManager = this.app.dragManager;
      const file_path = curr.link.split('#')[0];
      const file = this.app.metadataCache.getFirstLinkpathDest(file_path, '');
      const dragData = dragManager.dragFile(event, file);
      // console.log(dragData);
      dragManager.onDragStart(event, dragData);
    });
    // if curr.link contains curly braces, return (incompatible with hover-link)
    if (curr.link.indexOf('{') > -1) return;
    // trigger hover event on link
    item.addEventListener('mouseover', (event) => {
      this.app.workspace.trigger('hover-link', {
        event,
        source: SMART_CONNECTIONS_VIEW_TYPE,
        hoverParent: list,
        targetEl: item,
        linktext: curr.link,
      });
    });
  }

  // get target file from link path
  // if sub-section is linked, open file and scroll to sub-section
  async open_note(curr, event = null) {
    let targetFile;
    let heading;
    if (curr.link.indexOf('#') > -1) {
      // remove after # from link
      targetFile = this.app.metadataCache.getFirstLinkpathDest(
        curr.link.split('#')[0],
        '',
      );
      // console.log(targetFile);
      const target_file_cache = this.app.metadataCache.getFileCache(targetFile);
      // console.log(target_file_cache);
      // get heading
      let heading_text = curr.link.split('#').pop();
      // if heading text contains a curly brace, get the number inside the curly braces as occurence
      let occurence = 0;
      if (heading_text.indexOf('{') > -1) {
        // get occurence
        occurence = parseInt(heading_text.split('{')[1].split('}')[0]);
        // remove occurence from heading text
        heading_text = heading_text.split('{')[0];
      }
      // get headings from file cache
      const headings = target_file_cache.headings;
      // get headings with the same depth and text as the link
      for (let i = 0; i < headings.length; i++) {
        if (headings[i].heading === heading_text) {
          // if occurence is 0, set heading and break
          if (occurence === 0) {
            heading = headings[i];
            break;
          }
          occurence--; // decrement occurence
        }
      }
      // console.log(heading);
    } else {
      targetFile = this.app.metadataCache.getFirstLinkpathDest(curr.link, '');
    }
    let leaf;
    if (event) {
      // properly handle if the meta/ctrl key is pressed
      const mod = Obsidian.Keymap.isModEvent(event);
      // get most recent leaf
      leaf = this.app.workspace.getLeaf(mod);
    } else {
      // get most recent leaf
      leaf = this.app.workspace.getMostRecentLeaf();
    }
    await leaf.openFile(targetFile);
    if (heading) {
      let { editor } = leaf.view;
      const pos = { line: heading.position.start.line, ch: 0 };
      editor.setCursor(pos);
      editor.scrollIntoView({ to: pos, from: pos }, true);
    }
  }

  render_block_context(block) {
    const block_headings = block.link.split('.md')[1].split('#');
    // starting with the last heading first, iterate through headings
    let block_context = '';
    for (let i = block_headings.length - 1; i >= 0; i--) {
      if (block_context.length > 0) {
        block_context = ` > ${block_context}`;
      }
      block_context = block_headings[i] + block_context;
      // if block context is longer than N characters, break
      if (block_context.length > 100) {
        break;
      }
    }
    // remove leading > if exists
    if (block_context.startsWith(' > ')) {
      block_context = block_context.slice(3);
    }
    return block_context;
  }

  renderable_file_type(link) {
    return link.indexOf('.md') !== -1 && link.indexOf('.excalidraw') === -1;
  }

  render_external_link_elm(meta) {
    if (meta.source) {
      if (meta.source === 'Gmail') meta.source = '📧 Gmail';
      return `<small>${meta.source}</small><br>${meta.title}`;
    }
    // remove http(s)://
    let domain = meta.path.replace(/(^\w+:|^)\/\//, '');
    // separate domain from path
    domain = domain.split('/')[0];
    // wrap domain in <small> and add line break
    return `<small>🌐 ${domain}</small><br>${meta.title}`;
  }
  // get all folders
  async get_all_folders() {
    if (!this.folders || this.folders.length === 0) {
      this.folders = await this.get_folders();
    }
    return this.folders;
  }
  // get folders, traverse non-hidden sub-folders
  async get_folders(path = '/') {
    let folders = (await this.app.vault.adapter.list(path)).folders;
    let folder_list = [];
    for (let i = 0; i < folders.length; i++) {
      if (folders[i].startsWith('.')) continue;
      folder_list.push(folders[i]);
      folder_list = folder_list.concat(
        await this.get_folders(folders[i] + '/'),
      );
    }
    return folder_list;
  }

  async sync_notes() {
    // if license key is not set, return
    if (!this.settings.license_key) {
      new Obsidian.Notice(
        'Smart Connections: Supporter license key is required to sync notes to the ChatGPT Plugin server.',
      );
      return;
    }
    console.log('syncing notes');
    // get all files in vault
    const files = this.app.vault.getMarkdownFiles().filter((file) => {
      // filter out file paths matching any strings in this.file_exclusions
      for (let i = 0; i < this.file_exclusions.length; i++) {
        if (file.path.indexOf(this.file_exclusions[i]) > -1) {
          return false;
        }
      }
      return true;
    });
    const notes = await this.build_notes_object(files);
    console.log('object built');
    // save notes object to .smart-connections/notes.json
    await this.app.vault.adapter.write(
      '.smart-connections/notes.json',
      JSON.stringify(notes, null, 2),
    );
    console.log('notes saved');
    console.log(this.settings.license_key);
    // POST notes object to server
    const response = await (0, Obsidian.requestUrl)({
      url: 'https://sync.smartconnections.app/sync',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      contentType: 'application/json',
      body: JSON.stringify({
        license_key: this.settings.license_key,
        notes: notes,
      }),
    });
    console.log(response);
  }

  async build_notes_object(files) {
    let output = {};

    for (let i = 0; i < files.length; i++) {
      let file = files[i];
      let parts = file.path.split('/');
      let current = output;

      for (let ii = 0; ii < parts.length; ii++) {
        let part = parts[ii];

        if (ii === parts.length - 1) {
          // This is a file
          current[part] = await this.app.vault.cachedRead(file);
        } else {
          // This is a directory
          if (!current[part]) {
            current[part] = {};
          }

          current = current[part];
        }
      }
    }

    return output;
  }
}

class ScSearchApi {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
  async search(search_text, filter = {}) {
    filter = {
      skip_sections: this.plugin.settings.skip_sections,
      ...filter,
    };
    let nearest = [];
    const resp = await this.plugin.request_embedding_from_input(search_text);
    if (resp && resp.data && resp.data[0] && resp.data[0].embedding) {
      nearest = this.plugin.smart_vec_lite.nearest(
        resp.data[0].embedding,
        filter,
      );
    } else {
      // resp is null, undefined, or missing data
      new Obsidian.Notice('Smart Connections: Error getting embedding');
    }
    return nearest;
  }
}

function line_is_heading(line) {
  return line.indexOf('#') === 0 && ['#', ' '].indexOf(line[1]) !== -1;
}
