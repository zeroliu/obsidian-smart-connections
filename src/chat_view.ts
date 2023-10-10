import * as Obsidian from 'obsidian';
import SmartConnectionsPlugin from 'src';

export const SMART_CONNECTIONS_CHAT_VIEW_TYPE = 'smart-connections-chat-view';

export class SmartConnectionsChatView extends Obsidian.ItemView {
  constructor(
    leaf: Obsidian.WorkspaceLeaf,
    private plugin: SmartConnectionsPlugin,
  ) {
    super(leaf);
    this.active_elm = null;
    this.active_stream = null;
    this.brackets_ct = 0;
    this.chat = null;
    this.chat_box = null;
    this.chat_container = null;
    this.current_chat_ml = [];
    this.files = [];
    this.last_from = null;
    this.message_container = null;
    this.prevent_input = false;
  }
  getDisplayText() {
    return 'Smart Connections Chat';
  }
  getIcon() {
    return 'message-square';
  }
  getViewType() {
    return SMART_CONNECTIONS_CHAT_VIEW_TYPE;
  }
  async onOpen() {
    this.new_chat();
    this.plugin.get_all_folders(); // sets this.plugin.folders necessary for folder-context
  }
  async onClose() {
    this.chat.save_chat();
    this.app.workspace.unregisterHoverLinkSource(
      SMART_CONNECTIONS_CHAT_VIEW_TYPE,
    );
  }
  render_chat() {
    this.containerEl.empty();
    this.chat_container = this.containerEl.createDiv('sc-chat-container');
    // render plus sign for clear button
    this.render_top_bar();
    // render chat messages container
    this.render_chat_box();
    // render chat input
    this.render_chat_input();
    this.plugin.render_brand(this.containerEl, 'chat');
  }
  // render plus sign for clear button
  render_top_bar() {
    // create container for clear button
    let top_bar_container = this.chat_container.createDiv(
      'sc-top-bar-container',
    );
    // render the name of the chat in an input box (pop content after last hyphen in chat_id)
    let chat_name = this.chat.name();
    let chat_name_input = top_bar_container.createEl('input', {
      attr: {
        type: 'text',
        value: chat_name,
      },
      cls: 'sc-chat-name-input',
    });
    chat_name_input.addEventListener('change', this.rename_chat.bind(this));

    // create button to Smart View
    let smart_view_btn = this.create_top_bar_button(
      top_bar_container,
      'Smart View',
      'smart-connections',
    );
    smart_view_btn.addEventListener('click', this.open_smart_view.bind(this));
    // create button to save chat
    let save_btn = this.create_top_bar_button(
      top_bar_container,
      'Save Chat',
      'save',
    );
    save_btn.addEventListener('click', this.save_chat.bind(this));
    // create button to open chat history modal
    let history_btn = this.create_top_bar_button(
      top_bar_container,
      'Chat History',
      'history',
    );
    history_btn.addEventListener('click', this.open_chat_history.bind(this));
    // create button to start new chat
    const new_chat_btn = this.create_top_bar_button(
      top_bar_container,
      'New Chat',
      'plus',
    );
    new_chat_btn.addEventListener('click', this.new_chat.bind(this));
  }
  async open_chat_history() {
    const folder = await this.app.vault.adapter.list(
      '.smart-connections/chats',
    );
    this.files = folder.files.map((file) => {
      return file.replace('.smart-connections/chats/', '').replace('.json', '');
    });
    // open chat history modal
    if (!this.modal)
      this.modal = new SmartConnectionsChatHistoryModal(this.app, this);
    this.modal.open();
  }

  create_top_bar_button(top_bar_container, title, icon = null) {
    let btn = top_bar_container.createEl('button', {
      attr: {
        title: title,
      },
    });
    if (icon) {
      Obsidian.setIcon(btn, icon);
    } else {
      btn.innerHTML = title;
    }
    return btn;
  }
  // render new chat
  new_chat() {
    this.clear_chat();
    this.render_chat();
    // render initial message from assistant (don't use render_message to skip adding to chat history)
    this.new_messsage_bubble('assistant');
    this.active_elm.innerHTML =
      '<p>' +
      SMART_TRANSLATION[this.plugin.settings.language].initial_message +
      '</p>';
  }
  // open a chat from the chat history modal
  async open_chat(chat_id) {
    this.clear_chat();
    await this.chat.load_chat(chat_id);
    this.render_chat();
    for (let i = 0; i < this.chat.chat_ml.length; i++) {
      await this.render_message(
        this.chat.chat_ml[i].content,
        this.chat.chat_ml[i].role,
      );
    }
  }
  // clear current chat state
  clear_chat() {
    if (this.chat) {
      this.chat.save_chat();
    }
    this.chat = new SmartConnectionsChatModel(this.plugin);
    // if this.dotdotdot_interval is not null, clear interval
    if (this.dotdotdot_interval) {
      clearInterval(this.dotdotdot_interval);
    }
    // clear current chat ml
    this.current_chat_ml = [];
    // update prevent input
    this.end_stream();
  }

  rename_chat(event) {
    let new_chat_name = event.target.value;
    this.chat.rename_chat(new_chat_name);
  }

  // save current chat
  save_chat() {
    this.chat.save_chat();
    new Obsidian.Notice('[Smart Connections] Chat saved');
  }

  open_smart_view() {
    this.plugin.open_view();
  }
  // render chat messages container
  render_chat_box() {
    // create container for chat messages
    this.chat_box = this.chat_container.createDiv('sc-chat-box');
    // create container for message
    this.message_container = this.chat_box.createDiv('sc-message-container');
  }
  // open file suggestion modal
  open_file_suggestion_modal() {
    // open file suggestion modal
    if (!this.file_selector)
      this.file_selector = new SmartConnectionsFileSelectModal(this.app, this);
    this.file_selector.open();
  }
  // open folder suggestion modal
  async open_folder_suggestion_modal() {
    // open folder suggestion modal
    if (!this.folder_selector) {
      this.folder_selector = new SmartConnectionsFolderSelectModal(
        this.app,
        this,
      );
    }
    this.folder_selector.open();
  }
  // insert_selection from file suggestion modal
  insert_selection(insert_text) {
    // get caret position
    let caret_pos = this.textarea.selectionStart;
    // get text before caret
    let text_before = this.textarea.value.substring(0, caret_pos);
    // get text after caret
    let text_after = this.textarea.value.substring(
      caret_pos,
      this.textarea.value.length,
    );
    // insert text
    this.textarea.value = text_before + insert_text + text_after;
    // set caret position
    this.textarea.selectionStart = caret_pos + insert_text.length;
    this.textarea.selectionEnd = caret_pos + insert_text.length;
    // focus on textarea
    this.textarea.focus();
  }

  // render chat textarea and button
  render_chat_input() {
    // create container for chat input
    let chat_input = this.chat_container.createDiv('sc-chat-form');
    // create textarea
    this.textarea = chat_input.createEl('textarea', {
      cls: 'sc-chat-input',
      attr: {
        placeholder: `Try "Based on my notes" or "Summarize [[this note]]" or "Important tasks in /folder/"`,
      },
    });
    // use contenteditable instead of textarea
    // this.textarea = chat_input.createEl("div", {cls: "sc-chat-input", attr: {contenteditable: true}});
    // add event listener to listen for shift+enter
    chat_input.addEventListener('keyup', (e) => {
      if (['[', '/'].indexOf(e.key) === -1) return; // skip if key is not [ or /
      const caret_pos = this.textarea.selectionStart;
      // if key is open square bracket
      if (e.key === '[') {
        // if previous char is [
        if (this.textarea.value[caret_pos - 2] === '[') {
          // open file suggestion modal
          this.open_file_suggestion_modal();
          return;
        }
      } else {
        this.brackets_ct = 0;
      }
      // if / is pressed
      if (e.key === '/') {
        // get caret position
        // if this is first char or previous char is space
        if (
          this.textarea.value.length === 1 ||
          this.textarea.value[caret_pos - 2] === ' '
        ) {
          // open folder suggestion modal
          this.open_folder_suggestion_modal();
          return;
        }
      }
    });

    chat_input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        if (this.prevent_input) {
          console.log('wait until current response is finished');
          new Obsidian.Notice(
            '[Smart Connections] Wait until current response is finished',
          );
          return;
        }
        // get text from textarea
        let user_input = this.textarea.value;
        // clear textarea
        this.textarea.value = '';
        // initiate response from assistant
        this.initialize_response(user_input);
      }
      this.textarea.style.height = 'auto';
      this.textarea.style.height = this.textarea.scrollHeight + 'px';
    });
    // button container
    let button_container = chat_input.createDiv('sc-button-container');
    // create hidden abort button
    let abort_button = button_container.createEl('span', {
      attr: { id: 'sc-abort-button', style: 'display: none;' },
    });
    Obsidian.setIcon(abort_button, 'square');
    // add event listener to button
    abort_button.addEventListener('click', () => {
      // abort current response
      this.end_stream();
    });
    // create button
    let button = button_container.createEl('button', {
      attr: { id: 'sc-send-button' },
      cls: 'send-button',
    });
    button.innerHTML = 'Send';
    // add event listener to button
    button.addEventListener('click', () => {
      if (this.prevent_input) {
        console.log('wait until current response is finished');
        new Obsidian.Notice('Wait until current response is finished');
        return;
      }
      // get text from textarea
      let user_input = this.textarea.value;
      // clear textarea
      this.textarea.value = '';
      // initiate response from assistant
      this.initialize_response(user_input);
    });
  }
  async initialize_response(user_input) {
    this.set_streaming_ux();
    // render message
    await this.render_message(user_input, 'user');
    this.chat.new_message_in_thread({
      role: 'user',
      content: user_input,
    });
    await this.render_dotdotdot();

    // if contains internal link represented by [[link]]
    if (this.chat.contains_internal_link(user_input)) {
      this.chat.get_response_with_note_context(user_input, this);
      return;
    }
    // // for testing purposes
    // if(this.chat.contains_folder_reference(user_input)) {
    //   const folders = this.chat.get_folder_references(user_input);
    //   console.log(folders);
    //   return;
    // }
    // if contains self referential keywords or folder reference
    if (
      this.contains_self_referential_keywords(user_input) ||
      this.chat.contains_folder_reference(user_input)
    ) {
      // get hyde
      const context = await this.get_context_hyde(user_input);
      // get user input with added context
      // const context_input = this.build_context_input(context);
      // console.log(context_input);
      const chatml = [
        {
          role: 'system',
          // content: context_input
          content: context,
        },
        {
          role: 'user',
          content: user_input,
        },
      ];
      this.request_chatgpt_completion({ messages: chatml, temperature: 0 });
      return;
    }
    // completion without any specific context
    this.request_chatgpt_completion();
  }

  async render_dotdotdot() {
    if (this.dotdotdot_interval) clearInterval(this.dotdotdot_interval);
    await this.render_message('...', 'assistant');
    // if is '...', then initiate interval to change to '.' and then to '..' and then to '...'
    let dots = 0;
    this.active_elm.innerHTML = '...';
    this.dotdotdot_interval = setInterval(() => {
      dots++;
      if (dots > 3) dots = 1;
      this.active_elm.innerHTML = '.'.repeat(dots);
    }, 500);
    // wait 2 seconds for testing
    // await new Promise(r => setTimeout(r, 2000));
  }

  set_streaming_ux() {
    this.prevent_input = true;
    // hide send button
    if (document.getElementById('sc-send-button'))
      document.getElementById('sc-send-button').style.display = 'none';
    // show abort button
    if (document.getElementById('sc-abort-button'))
      document.getElementById('sc-abort-button').style.display = 'block';
  }
  unset_streaming_ux() {
    this.prevent_input = false;
    // show send button, remove display none
    if (document.getElementById('sc-send-button'))
      document.getElementById('sc-send-button').style.display = '';
    // hide abort button
    if (document.getElementById('sc-abort-button'))
      document.getElementById('sc-abort-button').style.display = 'none';
  }

  // check if includes keywords referring to one's own notes
  contains_self_referential_keywords(user_input) {
    const matches = user_input.match(this.plugin.self_ref_kw_regex);
    if (matches) return true;
    return false;
  }

  // render message
  async render_message(message, from = 'assistant', append_last = false) {
    // if dotdotdot interval is set, then clear it
    if (this.dotdotdot_interval) {
      clearInterval(this.dotdotdot_interval);
      this.dotdotdot_interval = null;
      // clear last message
      this.active_elm.innerHTML = '';
    }
    if (append_last) {
      this.current_message_raw += message;
      if (message.indexOf('\n') === -1) {
        this.active_elm.innerHTML += message;
      } else {
        this.active_elm.innerHTML = '';
        // append to last message
        await Obsidian.MarkdownRenderer.renderMarkdown(
          this.current_message_raw,
          this.active_elm,
          '?no-dataview',
          new Obsidian.Component(),
        );
      }
    } else {
      this.current_message_raw = '';
      if (this.chat.thread.length === 0 || this.last_from !== from) {
        // create message
        this.new_messsage_bubble(from);
      }
      // set message text
      this.active_elm.innerHTML = '';
      await Obsidian.MarkdownRenderer.renderMarkdown(
        message,
        this.active_elm,
        '?no-dataview',
        new Obsidian.Component(),
      );
      // get links
      this.handle_links_in_message();
      // render button(s)
      this.render_message_action_buttons(message);
    }
    // scroll to bottom
    this.message_container.scrollTop = this.message_container.scrollHeight;
  }
  render_message_action_buttons(message) {
    if (this.chat.context && this.chat.hyd) {
      // render button to copy hyd in smart-connections code block
      const context_view = this.active_elm.createEl('span', {
        cls: 'sc-msg-button',
        attr: {
          title: 'Copy context to clipboard' /* tooltip */,
        },
      });
      const this_hyd = this.chat.hyd;
      Obsidian.setIcon(context_view, 'eye');
      context_view.addEventListener('click', () => {
        // copy to clipboard
        navigator.clipboard.writeText(
          '```smart-connections\n' + this_hyd + '\n```\n',
        );
        new Obsidian.Notice(
          '[Smart Connections] Context code block copied to clipboard',
        );
      });
    }
    if (this.chat.context) {
      // render copy context button
      const copy_prompt_button = this.active_elm.createEl('span', {
        cls: 'sc-msg-button',
        attr: {
          title: 'Copy prompt to clipboard' /* tooltip */,
        },
      });
      const this_context = this.chat.context
        .replace(/\`\`\`/g, '\t```')
        .trimLeft();
      Obsidian.setIcon(copy_prompt_button, 'files');
      copy_prompt_button.addEventListener('click', () => {
        // copy to clipboard
        navigator.clipboard.writeText(
          '```prompt-context\n' + this_context + '\n```\n',
        );
        new Obsidian.Notice('[Smart Connections] Context copied to clipboard');
      });
    }
    // render copy button
    const copy_button = this.active_elm.createEl('span', {
      cls: 'sc-msg-button',
      attr: {
        title: 'Copy message to clipboard' /* tooltip */,
      },
    });
    Obsidian.setIcon(copy_button, 'copy');
    copy_button.addEventListener('click', () => {
      // copy message to clipboard
      navigator.clipboard.writeText(message.trimLeft());
      new Obsidian.Notice('[Smart Connections] Message copied to clipboard');
    });
  }

  handle_links_in_message() {
    const links = this.active_elm.querySelectorAll('a');
    // if this active element contains a link
    if (links.length > 0) {
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const link_text = link.getAttribute('data-href');
        // trigger hover event on link
        link.addEventListener('mouseover', (event) => {
          this.app.workspace.trigger('hover-link', {
            event,
            source: SMART_CONNECTIONS_CHAT_VIEW_TYPE,
            hoverParent: link.parentElement,
            targetEl: link,
            // extract link text from a.data-href
            linktext: link_text,
          });
        });
        // trigger open link event on link
        link.addEventListener('click', (event) => {
          const link_tfile = this.app.metadataCache.getFirstLinkpathDest(
            link_text,
            '/',
          );
          // properly handle if the meta/ctrl key is pressed
          const mod = Obsidian.Keymap.isModEvent(event);
          // get most recent leaf
          let leaf = this.app.workspace.getLeaf(mod);
          leaf.openFile(link_tfile);
        });
      }
    }
  }

  new_messsage_bubble(from) {
    let message_el = this.message_container.createDiv(`sc-message ${from}`);
    // create message content
    this.active_elm = message_el.createDiv('sc-message-content');
    // set last from
    this.last_from = from;
  }

  async request_chatgpt_completion(opts = {}) {
    const chat_ml =
      opts.messages || opts.chat_ml || this.chat.prepare_chat_ml();
    console.log('chat_ml', chat_ml);
    const max_total_tokens = Math.round(
      get_max_chars(this.plugin.settings.smart_chat_model) / 4,
    );
    console.log('max_total_tokens', max_total_tokens);
    const curr_token_est = Math.round(JSON.stringify(chat_ml).length / 3);
    console.log('curr_token_est', curr_token_est);
    let max_available_tokens = max_total_tokens - curr_token_est;
    // if max_available_tokens is less than 0, set to 200
    if (max_available_tokens < 0) max_available_tokens = 200;
    console.log('max_available_tokens', max_available_tokens);
    opts = {
      model: this.plugin.settings.smart_chat_model,
      messages: chat_ml,
      // max_tokens: 250,
      max_tokens: max_available_tokens,
      temperature: 0.3,
      top_p: 1,
      presence_penalty: 0,
      frequency_penalty: 0,
      stream: true,
      stop: null,
      n: 1,
      // logit_bias: logit_bias,
      ...opts,
    };
    // console.log(opts.messages);
    if (opts.stream) {
      const full_str = await new Promise((resolve, reject) => {
        try {
          // console.log("stream", opts);
          const url = 'https://api.openai.com/v1/chat/completions';
          this.active_stream = new ScStreamer(url, {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.plugin.settings.api_key}`,
            },
            method: 'POST',
            payload: JSON.stringify(opts),
          });
          let txt = '';
          this.active_stream.addEventListener('message', (e) => {
            if (e.data != '[DONE]') {
              const payload = JSON.parse(e.data);
              const text = payload.choices[0].delta.content;
              if (!text) {
                return;
              }
              txt += text;
              this.render_message(text, 'assistant', true);
            } else {
              this.end_stream();
              resolve(txt);
            }
          });
          this.active_stream.addEventListener('readystatechange', (e) => {
            if (e.readyState >= 2) {
              console.log('ReadyState: ' + e.readyState);
            }
          });
          this.active_stream.addEventListener('error', (e) => {
            console.error(e);
            new Obsidian.Notice(
              'Smart Connections Error Streaming Response. See console for details.',
            );
            this.render_message(
              '*API Error. See console logs for details.*',
              'assistant',
            );
            this.end_stream();
            reject(e);
          });
          this.active_stream.stream();
        } catch (err) {
          console.error(err);
          new Obsidian.Notice(
            'Smart Connections Error Streaming Response. See console for details.',
          );
          this.end_stream();
          reject(err);
        }
      });
      // console.log(full_str);
      await this.render_message(full_str, 'assistant');
      this.chat.new_message_in_thread({
        role: 'assistant',
        content: full_str,
      });
      return;
    } else {
      try {
        const response = await (0, Obsidian.requestUrl)({
          url: `https://api.openai.com/v1/chat/completions`,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.plugin.settings.api_key}`,
            'Content-Type': 'application/json',
          },
          contentType: 'application/json',
          body: JSON.stringify(opts),
          throw: false,
        });
        // console.log(response);
        return JSON.parse(response.text).choices[0].message.content;
      } catch (err) {
        new Obsidian.Notice(`Smart Connections API Error :: ${err}`);
      }
    }
  }

  end_stream() {
    if (this.active_stream) {
      this.active_stream.close();
      this.active_stream = null;
    }
    this.unset_streaming_ux();
    if (this.dotdotdot_interval) {
      clearInterval(this.dotdotdot_interval);
      this.dotdotdot_interval = null;
      // remove parent of active_elm
      this.active_elm.parentElement.remove();
      this.active_elm = null;
    }
  }

  async get_context_hyde(user_input) {
    this.chat.reset_context();
    // count current chat ml messages to determine 'question' or 'chat log' wording
    const hyd_input = `Anticipate what the user is seeking. Respond in the form of a hypothetical note written by the user. The note may contain statements as paragraphs, lists, or checklists in markdown format with no headings. Please respond with one hypothetical note and abstain from any other commentary. Use the format: PARENT FOLDER NAME > CHILD FOLDER NAME > FILE NAME > HEADING 1 > HEADING 2 > HEADING 3: HYPOTHETICAL NOTE CONTENTS.`;
    // complete
    const chatml = [
      {
        role: 'system',
        content: hyd_input,
      },
      {
        role: 'user',
        content: user_input,
      },
    ];
    const hyd = await this.request_chatgpt_completion({
      messages: chatml,
      stream: false,
      temperature: 0,
      max_tokens: 137,
    });
    this.chat.hyd = hyd;
    // console.log(hyd);
    let filter = {};
    // if contains folder reference represented by /folder/
    if (this.chat.contains_folder_reference(user_input)) {
      // get folder references
      const folder_refs = this.chat.get_folder_references(user_input);
      // console.log(folder_refs);
      // if folder references are valid (string or array of strings)
      if (folder_refs) {
        filter = {
          path_begins_with: folder_refs,
        };
      }
    }
    // search for nearest based on hyd
    let nearest = await this.plugin.api.search(hyd, filter);
    console.log('nearest', nearest.length);
    nearest = this.get_nearest_until_next_dev_exceeds_std_dev(nearest);
    console.log('nearest after std dev slice', nearest.length);
    nearest = this.sort_by_len_adjusted_similarity(nearest);

    return await this.get_context_for_prompt(nearest);
  }

  sort_by_len_adjusted_similarity(nearest) {
    // re-sort by quotient of similarity divided by len DESC
    nearest = nearest.sort((a, b) => {
      const a_score = a.similarity / a.len;
      const b_score = b.similarity / b.len;
      // if a is greater than b, return -1
      if (a_score > b_score) return -1;
      // if a is less than b, return 1
      if (a_score < b_score) return 1;
      // if a is equal to b, return 0
      return 0;
    });
    return nearest;
  }

  get_nearest_until_next_dev_exceeds_std_dev(nearest) {
    // get std dev of similarity
    const sim = nearest.map((n) => n.similarity);
    const mean = sim.reduce((a, b) => a + b) / sim.length;
    const std_dev = Math.sqrt(
      sim.map((x) => Math.pow(x - mean, 2)).reduce((a, b) => a + b) /
        sim.length,
    );
    // slice where next item deviation is greater than std_dev
    let slice_i = 0;
    while (slice_i < nearest.length) {
      const next = nearest[slice_i + 1];
      if (next) {
        const next_dev = Math.abs(
          next.similarity - nearest[slice_i].similarity,
        );
        if (next_dev > std_dev) {
          break;
        }
      }
      slice_i++;
    }
    // select top results
    nearest = nearest.slice(0, slice_i + 1);
    return nearest;
  }
  // this.test_get_nearest_until_next_dev_exceeds_std_dev();
  // // test get_nearest_until_next_dev_exceeds_std_dev
  // test_get_nearest_until_next_dev_exceeds_std_dev() {
  //   const nearest = [{similarity: 0.99}, {similarity: 0.98}, {similarity: 0.97}, {similarity: 0.96}, {similarity: 0.95}, {similarity: 0.94}, {similarity: 0.93}, {similarity: 0.92}, {similarity: 0.91}, {similarity: 0.9}, {similarity: 0.79}, {similarity: 0.78}, {similarity: 0.77}, {similarity: 0.76}, {similarity: 0.75}, {similarity: 0.74}, {similarity: 0.73}, {similarity: 0.72}];
  //   const result = this.get_nearest_until_next_dev_exceeds_std_dev(nearest);
  //   if(result.length !== 10){
  //     console.error("get_nearest_until_next_dev_exceeds_std_dev failed", result);
  //   }
  // }

  async get_context_for_prompt(nearest) {
    let context = [];
    const MAX_SOURCES = 20; // 10 * 1000 (max chars) = 10,000 chars (must be under ~16,000 chars or 4K tokens)
    const MAX_CHARS = get_max_chars(this.plugin.settings.smart_chat_model) / 2;
    let char_accum = 0;
    for (let i = 0; i < nearest.length; i++) {
      if (context.length >= MAX_SOURCES) break;
      if (char_accum >= MAX_CHARS) break;
      if (typeof nearest[i].link !== 'string') continue;
      // generate breadcrumbs
      const breadcrumbs = nearest[i].link
        .replace(/#/g, ' > ')
        .replace('.md', '')
        .replace(/\//g, ' > ');
      let new_context = `${breadcrumbs}:\n`;
      // get max available chars to add to context
      const max_available_chars = MAX_CHARS - char_accum - new_context.length;
      if (nearest[i].link.indexOf('#') !== -1) {
        // is block
        new_context += await this.plugin.block_retriever(nearest[i].link, {
          max_chars: max_available_chars,
        });
      } else {
        // is file
        new_context += await this.plugin.file_retriever(nearest[i].link, {
          max_chars: max_available_chars,
        });
      }
      // add to char_accum
      char_accum += new_context.length;
      // add to context
      context.push({
        link: nearest[i].link,
        text: new_context,
      });
    }
    // context sources
    console.log('context sources: ' + context.length);
    // char_accum divided by 4 and rounded to nearest integer for estimated tokens
    console.log('total context tokens: ~' + Math.round(char_accum / 3.5));
    // build context input
    this.chat.context = `Anticipate the type of answer desired by the user. Imagine the following ${
      context.length
    } notes were written by the user and contain all the necessary information to answer the user's question. Begin responses with "${
      SMART_TRANSLATION[this.plugin.settings.language].prompt
    }..."`;
    for (let i = 0; i < context.length; i++) {
      this.chat.context += `\n---BEGIN #${i + 1}---\n${
        context[i].text
      }\n---END #${i + 1}---`;
    }
    return this.chat.context;
  }
}

/**
 * SmartConnectionsChatModel
 * ---
 * - 'thread' format: Array[Array[Object{role, content, hyde}]]
 *  - [Turn[variation{}], Turn[variation{}, variation{}], ...]
 * - Saves in 'thread' format to JSON file in .smart-connections folder using chat_id as filename
 * - Loads chat in 'thread' format Array[Array[Object{role, content, hyde}]] from JSON file in .smart-connections folder
 * - prepares chat_ml returns in 'ChatML' format
 *  - strips all but role and content properties from Object in ChatML format
 * - ChatML Array[Object{role, content}]
 *  - [Current_Variation_For_Turn_1{}, Current_Variation_For_Turn_2{}, ...]
 */
class SmartConnectionsChatModel {
  constructor(plugin) {
    this.app = plugin.app;
    this.plugin = plugin;
    this.chat_id = null;
    this.chat_ml = [];
    this.context = null;
    this.hyd = null;
    this.thread = [];
  }
  async save_chat() {
    // return if thread is empty
    if (this.thread.length === 0) return;
    // save chat to file in .smart-connections folder
    // create .smart-connections/chats/ folder if it doesn't exist
    if (!(await this.app.vault.adapter.exists('.smart-connections/chats'))) {
      await this.app.vault.adapter.mkdir('.smart-connections/chats');
    }
    // if chat_id is not set, set it to UNTITLED-${unix timestamp}
    if (!this.chat_id) {
      this.chat_id = this.name() + '—' + this.get_file_date_string();
    }
    // validate chat_id is set to valid filename characters (letters, numbers, underscores, dashes, em dash, and spaces)
    if (!this.chat_id.match(/^[a-zA-Z0-9_—\- ]+$/)) {
      console.log('Invalid chat_id: ' + this.chat_id);
      new Obsidian.Notice(
        "[Smart Connections] Failed to save chat. Invalid chat_id: '" +
          this.chat_id +
          "'",
      );
    }
    // filename is chat_id
    const chat_file = this.chat_id + '.json';
    this.app.vault.adapter.write(
      '.smart-connections/chats/' + chat_file,
      JSON.stringify(this.thread, null, 2),
    );
  }
  async load_chat(chat_id) {
    this.chat_id = chat_id;
    // load chat from file in .smart-connections folder
    // filename is chat_id
    const chat_file = this.chat_id + '.json';
    // read file
    let chat_json = await this.app.vault.adapter.read(
      '.smart-connections/chats/' + chat_file,
    );
    // parse json
    this.thread = JSON.parse(chat_json);
    // load chat_ml
    this.chat_ml = this.prepare_chat_ml();
    // render messages in chat view
    // for each turn in chat_ml
    // console.log(this.thread);
    // console.log(this.chat_ml);
  }
  // prepare chat_ml from chat
  // gets the last message of each turn unless turn_variation_offsets=[[turn_index,variation_index]] is specified in offset
  prepare_chat_ml(turn_variation_offsets = []) {
    // if no turn_variation_offsets, get the last message of each turn
    if (turn_variation_offsets.length === 0) {
      this.chat_ml = this.thread.map((turn) => {
        return turn[turn.length - 1];
      });
    } else {
      // create an array from turn_variation_offsets that indexes variation_index at turn_index
      // ex. [[3,5]] => [undefined, undefined, undefined, 5]
      let turn_variation_index = [];
      for (let i = 0; i < turn_variation_offsets.length; i++) {
        turn_variation_index[turn_variation_offsets[i][0]] =
          turn_variation_offsets[i][1];
      }
      // loop through chat
      this.chat_ml = this.thread.map((turn, turn_index) => {
        // if there is an index for this turn, return the variation at that index
        if (turn_variation_index[turn_index] !== undefined) {
          return turn[turn_variation_index[turn_index]];
        }
        // otherwise return the last message of the turn
        return turn[turn.length - 1];
      });
    }
    // strip all but role and content properties from each message
    this.chat_ml = this.chat_ml.map((message) => {
      return {
        role: message.role,
        content: message.content,
      };
    });
    return this.chat_ml;
  }
  last() {
    // get last message from chat
    return this.thread[this.thread.length - 1][
      this.thread[this.thread.length - 1].length - 1
    ];
  }
  last_from() {
    return this.last().role;
  }
  // returns user_input or completion
  last_message() {
    return this.last().content;
  }
  // message={}
  // add new message to thread
  new_message_in_thread(message, turn = -1) {
    // if turn is -1, add to new turn
    if (this.context) {
      message.context = this.context;
      this.context = null;
    }
    if (this.hyd) {
      message.hyd = this.hyd;
      this.hyd = null;
    }
    if (turn === -1) {
      this.thread.push([message]);
    } else {
      // otherwise add to specified turn
      this.thread[turn].push(message);
    }
  }
  reset_context() {
    this.context = null;
    this.hyd = null;
  }
  async rename_chat(new_name) {
    // check if current chat_id file exists
    if (
      this.chat_id &&
      (await this.app.vault.adapter.exists(
        '.smart-connections/chats/' + this.chat_id + '.json',
      ))
    ) {
      new_name = this.chat_id.replace(this.name(), new_name);
      // rename file if it exists
      await this.app.vault.adapter.rename(
        '.smart-connections/chats/' + this.chat_id + '.json',
        '.smart-connections/chats/' + new_name + '.json',
      );
      // set chat_id to new_name
      this.chat_id = new_name;
    } else {
      this.chat_id = new_name + '—' + this.get_file_date_string();
      // save chat
      await this.save_chat();
    }
  }

  name() {
    if (this.chat_id) {
      // remove date after last em dash
      return this.chat_id.replace(/—[^—]*$/, '');
    }
    return 'UNTITLED';
  }

  get_file_date_string() {
    return new Date()
      .toISOString()
      .replace(/(T|:|\..*)/g, ' ')
      .trim();
  }
  // get response from with note context
  async get_response_with_note_context(user_input, chat_view) {
    let system_input =
      "Imagine the following notes were written by the user and contain the necessary information to synthesize a useful answer the user's query:\n";
    // extract internal links
    const notes = this.extract_internal_links(user_input);
    // get content of internal links as context
    let max_chars = get_max_chars(this.plugin.settings.smart_chat_model);
    for (let i = 0; i < notes.length; i++) {
      // max chars for this note is max_chars divided by number of notes left
      const this_max_chars =
        notes.length - i > 1
          ? Math.floor(max_chars / (notes.length - i))
          : max_chars;
      // console.log("file context max chars: " + this_max_chars);
      const note_content = await this.get_note_contents(notes[i], {
        char_limit: this_max_chars,
      });
      system_input += `---BEGIN NOTE: [[${notes[i].basename}]]---\n`;
      system_input += note_content;
      system_input += `---END NOTE---\n`;
      max_chars -= note_content.length;
      if (max_chars <= 0) break;
    }
    this.context = system_input;
    const chatml = [
      {
        role: 'system',
        content: system_input,
      },
      {
        role: 'user',
        content: user_input,
      },
    ];
    chat_view.request_chatgpt_completion({ messages: chatml, temperature: 0 });
  }
  // check if contains internal link
  contains_internal_link(user_input) {
    if (user_input.indexOf('[[') === -1) return false;
    if (user_input.indexOf(']]') === -1) return false;
    return true;
  }
  // check if contains folder reference (ex. /folder/, or /folder/subfolder/)
  contains_folder_reference(user_input) {
    if (user_input.indexOf('/') === -1) return false;
    if (user_input.indexOf('/') === user_input.lastIndexOf('/')) return false;
    return true;
  }
  // get folder references from user input
  get_folder_references(user_input) {
    // use this.folders to extract folder references by longest first (ex. /folder/subfolder/ before /folder/) to avoid matching /folder/subfolder/ as /folder/
    const folders = this.plugin.folders.slice(); // copy folders array
    const matches = folders
      .sort((a, b) => b.length - a.length)
      .map((folder) => {
        // check if folder is in user_input
        if (user_input.indexOf(folder) !== -1) {
          // remove folder from user_input to prevent matching /folder/subfolder/ as /folder/
          user_input = user_input.replace(folder, '');
          return folder;
        }
        return false;
      })
      .filter((folder) => folder);
    console.log(matches);
    // return array of matches
    if (matches) return matches;
    return false;
  }

  // extract internal links
  extract_internal_links(user_input) {
    const matches = user_input.match(/\[\[(.*?)\]\]/g);
    console.log(matches);
    // return array of TFile objects
    if (matches)
      return matches.map((match) => {
        return this.app.metadataCache.getFirstLinkpathDest(
          match.replace('[[', '').replace(']]', ''),
          '/',
        );
      });
    return [];
  }
  // get context from internal links
  async get_note_contents(note, opts = {}) {
    opts = {
      char_limit: 10000,
      ...opts,
    };
    // return if note is not a file
    if (!(note instanceof Obsidian.TFile)) return '';
    // get file content
    let file_content = await this.app.vault.cachedRead(note);
    // check if contains dataview code block
    if (file_content.indexOf('```dataview') > -1) {
      // if contains dataview code block get all dataview code blocks
      file_content = await this.render_dataview_queries(
        file_content,
        note.path,
        opts,
      );
    }
    file_content = file_content.substring(0, opts.char_limit);
    // console.log(file_content.length);
    return file_content;
  }

  async render_dataview_queries(file_content, note_path, opts = {}) {
    opts = {
      char_limit: null,
      ...opts,
    };
    // use window to get dataview api
    const dataview_api = window['DataviewAPI'];
    // skip if dataview api not found
    if (!dataview_api) return file_content;
    const dataview_code_blocks = file_content.match(/```dataview(.*?)```/gs);
    // for each dataview code block
    for (let i = 0; i < dataview_code_blocks.length; i++) {
      // if opts char_limit is less than indexOf dataview code block, break
      if (
        opts.char_limit &&
        opts.char_limit < file_content.indexOf(dataview_code_blocks[i])
      )
        break;
      // get dataview code block
      const dataview_code_block = dataview_code_blocks[i];
      // get content of dataview code block
      const dataview_code_block_content = dataview_code_block
        .replace('```dataview', '')
        .replace('```', '');
      // get dataview query result
      const dataview_query_result = await dataview_api.queryMarkdown(
        dataview_code_block_content,
        note_path,
        null,
      );
      // if query result is successful, replace dataview code block with query result
      if (dataview_query_result.successful) {
        file_content = file_content.replace(
          dataview_code_block,
          dataview_query_result.value,
        );
      }
    }
    return file_content;
  }
}

class SmartConnectionsChatHistoryModal extends Obsidian.FuzzySuggestModal {
  constructor(app, view, files) {
    super(app);
    this.app = app;
    this.view = view;
    this.setPlaceholder('Type the name of a chat session...');
  }
  getItems() {
    if (!this.view.files) {
      return [];
    }
    return this.view.files;
  }
  getItemText(item) {
    // if not UNTITLED, remove date after last em dash
    if (item.indexOf('UNTITLED') === -1) {
      item.replace(/—[^—]*$/, '');
    }
    return item;
  }
  onChooseItem(session) {
    this.view.open_chat(session);
  }
}

// File Select Fuzzy Suggest Modal
class SmartConnectionsFileSelectModal extends Obsidian.FuzzySuggestModal {
  constructor(app, view) {
    super(app);
    this.app = app;
    this.view = view;
    this.setPlaceholder('Type the name of a file...');
  }
  getItems() {
    // get all markdown files
    return this.app.vault
      .getMarkdownFiles()
      .sort((a, b) => a.basename.localeCompare(b.basename));
  }
  getItemText(item) {
    return item.basename;
  }
  onChooseItem(file) {
    this.view.insert_selection(file.basename + ']] ');
  }
}
// Folder Select Fuzzy Suggest Modal
class SmartConnectionsFolderSelectModal extends Obsidian.FuzzySuggestModal {
  constructor(app, view) {
    super(app);
    this.app = app;
    this.view = view;
    this.setPlaceholder('Type the name of a folder...');
  }
  getItems() {
    return this.view.plugin.folders;
  }
  getItemText(item) {
    return item;
  }
  onChooseItem(folder) {
    this.view.insert_selection(folder + '/ ');
  }
}

function get_max_chars(model = 'gpt-3.5-turbo') {
  const MAX_CHAR_MAP = {
    'gpt-3.5-turbo-16k': 48000,
    'gpt-4': 24000,
    'gpt-3.5-turbo': 12000,
  };
  return MAX_CHAR_MAP[model];
}

// Handle API response streaming
class ScStreamer {
  // constructor
  constructor(url, options) {
    // set default options
    options = options || {};
    this.url = url;
    this.method = options.method || 'GET';
    this.headers = options.headers || {};
    this.payload = options.payload || null;
    this.withCredentials = options.withCredentials || false;
    this.listeners = {};
    this.readyState = this.CONNECTING;
    this.progress = 0;
    this.chunk = '';
    this.xhr = null;
    this.FIELD_SEPARATOR = ':';
    this.INITIALIZING = -1;
    this.CONNECTING = 0;
    this.OPEN = 1;
    this.CLOSED = 2;
  }
  // addEventListener
  addEventListener(type, listener) {
    // check if the type is in the listeners
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    // check if the listener is already in the listeners
    if (this.listeners[type].indexOf(listener) === -1) {
      this.listeners[type].push(listener);
    }
  }
  // removeEventListener
  removeEventListener(type, listener) {
    // check if listener type is undefined
    if (!this.listeners[type]) {
      return;
    }
    let filtered = [];
    // loop through the listeners
    for (let i = 0; i < this.listeners[type].length; i++) {
      // check if the listener is the same
      if (this.listeners[type][i] !== listener) {
        filtered.push(this.listeners[type][i]);
      }
    }
    // check if the listeners are empty
    if (this.listeners[type].length === 0) {
      delete this.listeners[type];
    } else {
      this.listeners[type] = filtered;
    }
  }
  // dispatchEvent
  dispatchEvent(event) {
    // if no event return true
    if (!event) {
      return true;
    }
    // set event source to this
    event.source = this;
    // set onHandler to on + event type
    let onHandler = 'on' + event.type;
    // check if the onHandler has own property named same as onHandler
    if (this.hasOwnProperty(onHandler)) {
      // call the onHandler
      this[onHandler].call(this, event);
      // check if the event is default prevented
      if (event.defaultPrevented) {
        return false;
      }
    }
    // check if the event type is in the listeners
    if (this.listeners[event.type]) {
      return this.listeners[event.type].every(function (callback) {
        callback(event);
        return !event.defaultPrevented;
      });
    }
    return true;
  }
  // _setReadyState
  _setReadyState(state) {
    // set event type to readyStateChange
    let event = new CustomEvent('readyStateChange');
    // set event readyState to state
    event.readyState = state;
    // set readyState to state
    this.readyState = state;
    // dispatch event
    this.dispatchEvent(event);
  }
  // _onStreamFailure
  _onStreamFailure(e) {
    // set event type to error
    let event = new CustomEvent('error');
    // set event data to e
    event.data = e.currentTarget.response;
    // dispatch event
    this.dispatchEvent(event);
    this.close();
  }
  // _onStreamAbort
  _onStreamAbort(e) {
    // set to abort
    let event = new CustomEvent('abort');
    // close
    this.close();
  }
  // _onStreamProgress
  _onStreamProgress(e) {
    // if not xhr return
    if (!this.xhr) {
      return;
    }
    // if xhr status is not 200 return
    if (this.xhr.status !== 200) {
      // onStreamFailure
      this._onStreamFailure(e);
      return;
    }
    // if ready state is CONNECTING
    if (this.readyState === this.CONNECTING) {
      // dispatch event
      this.dispatchEvent(new CustomEvent('open'));
      // set ready state to OPEN
      this._setReadyState(this.OPEN);
    }
    // parse the received data.
    let data = this.xhr.responseText.substring(this.progress);
    // update progress
    this.progress += data.length;
    // split the data by new line and parse each line
    data.split(/(\r\n|\r|\n){2}/g).forEach(
      function (part) {
        if (part.trim().length === 0) {
          this.dispatchEvent(this._parseEventChunk(this.chunk.trim()));
          this.chunk = '';
        } else {
          this.chunk += part;
        }
      }.bind(this),
    );
  }
  // _onStreamLoaded
  _onStreamLoaded(e) {
    this._onStreamProgress(e);
    // parse the last chunk
    this.dispatchEvent(this._parseEventChunk(this.chunk));
    this.chunk = '';
  }
  // _parseEventChunk
  _parseEventChunk(chunk) {
    // if no chunk or chunk is empty return
    if (!chunk || chunk.length === 0) {
      return null;
    }
    // init e
    let e = { id: null, retry: null, data: '', event: 'message' };
    // split the chunk by new line
    chunk.split(/(\r\n|\r|\n)/).forEach(
      function (line) {
        line = line.trimRight();
        let index = line.indexOf(this.FIELD_SEPARATOR);
        if (index <= 0) {
          return;
        }
        // field
        let field = line.substring(0, index);
        if (!(field in e)) {
          return;
        }
        // value
        let value = line.substring(index + 1).trimLeft();
        if (field === 'data') {
          e[field] += value;
        } else {
          e[field] = value;
        }
      }.bind(this),
    );
    // return event
    let event = new CustomEvent(e.event);
    event.data = e.data;
    event.id = e.id;
    return event;
  }
  // _checkStreamClosed
  _checkStreamClosed() {
    if (!this.xhr) {
      return;
    }
    if (this.xhr.readyState === XMLHttpRequest.DONE) {
      this._setReadyState(this.CLOSED);
    }
  }
  // stream
  stream() {
    // set ready state to connecting
    this._setReadyState(this.CONNECTING);
    // set xhr to new XMLHttpRequest
    this.xhr = new XMLHttpRequest();
    // set xhr progress to _onStreamProgress
    this.xhr.addEventListener('progress', this._onStreamProgress.bind(this));
    // set xhr load to _onStreamLoaded
    this.xhr.addEventListener('load', this._onStreamLoaded.bind(this));
    // set xhr ready state change to _checkStreamClosed
    this.xhr.addEventListener(
      'readystatechange',
      this._checkStreamClosed.bind(this),
    );
    // set xhr error to _onStreamFailure
    this.xhr.addEventListener('error', this._onStreamFailure.bind(this));
    // set xhr abort to _onStreamAbort
    this.xhr.addEventListener('abort', this._onStreamAbort.bind(this));
    // open xhr
    this.xhr.open(this.method, this.url);
    // headers to xhr
    for (let header in this.headers) {
      this.xhr.setRequestHeader(header, this.headers[header]);
    }
    // credentials to xhr
    this.xhr.withCredentials = this.withCredentials;
    // send xhr
    this.xhr.send(this.payload);
  }
  // close
  close() {
    if (this.readyState === this.CLOSED) {
      return;
    }
    this.xhr.abort();
    this.xhr = null;
    this._setReadyState(this.CLOSED);
  }
}
