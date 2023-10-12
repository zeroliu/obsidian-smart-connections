import * as Obsidian from 'obsidian';
import SmartConnectionsPlugin from 'src';
import { SMART_TRANSLATION } from 'src/constants';

export class SmartConnectionsSettingsTab extends Obsidian.PluginSettingTab {
  plugin: SmartConnectionsPlugin;
  constructor(app: Obsidian.App, plugin: SmartConnectionsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', {
      text: 'Supporter Settings',
    });
    // list supporter benefits
    containerEl.createEl('p', {
      text: 'As a Smart Connections "Supporter", fast-track your PKM journey with priority perks and pioneering innovations.',
    });
    // three list items
    const supporter_benefits_list = containerEl.createEl('ul');
    supporter_benefits_list.createEl('li', {
      text: 'Enjoy swift, top-priority support.',
    });
    supporter_benefits_list.createEl('li', {
      text: 'Gain early access to experimental features like the ChatGPT plugin.',
    });
    supporter_benefits_list.createEl('li', {
      text: 'Stay informed and engaged with exclusive supporter-only communications.',
    });
    // add a text input to enter supporter license key
    new Obsidian.Setting(containerEl)
      .setName('Supporter License Key')
      .setDesc('Note: this is not required to use Smart Connections.')
      .addText((text) =>
        text
          .setPlaceholder('Enter your license_key')
          .setValue(this.plugin.settings.license_key)
          .onChange(async (value) => {
            this.plugin.settings.license_key = value.trim();
            await this.plugin.saveSettings(true);
          }),
      );
    // add button to trigger sync notes to use with ChatGPT
    new Obsidian.Setting(containerEl)
      .setName('Sync Notes')
      .setDesc(
        'Make notes available via the Smart Connections ChatGPT Plugin. Respects exclusion settings configured below.',
      )
      .addButton((button) =>
        button.setButtonText('Sync Notes').onClick(async () => {
          // sync notes
          await this.plugin.sync_notes();
        }),
      );
    // add button to become a supporter
    new Obsidian.Setting(containerEl)
      .setName('Become a Supporter')
      .setDesc('Become a Supporter')
      .addButton((button) =>
        button.setButtonText('Become a Supporter').onClick(async () => {
          const payment_pages = [
            'https://buy.stripe.com/9AQ5kO5QnbAWgGAbIY',
            'https://buy.stripe.com/9AQ7sWemT48u1LGcN4',
          ];
          if (!this.plugin.payment_page_index) {
            this.plugin.payment_page_index = Math.round(Math.random());
          }
          // open supporter page in browser
          window.open(payment_pages[this.plugin.payment_page_index]);
        }),
      );

    containerEl.createEl('h2', {
      text: 'OpenAI Settings',
    });
    // add a text input to enter the API key
    new Obsidian.Setting(containerEl)
      .setName('OpenAI API Key')
      .setDesc(
        'Required: an OpenAI API key is currently required to use Smart Connections.',
      )
      .addText((text) =>
        text
          .setPlaceholder('Enter your api_key')
          .setValue(this.plugin.settings.api_key)
          .onChange(async (value) => {
            this.plugin.settings.api_key = value.trim();
            await this.plugin.saveSettings(true);
          }),
      );
    // add a button to test the API key is working
    new Obsidian.Setting(containerEl)
      .setName('Test API Key')
      .setDesc('Test API Key')
      .addButton((button) =>
        button.setButtonText('Test API Key').onClick(async () => {
          // test API key
          const resp = await this.plugin.testApiKey();
          if (resp) {
            new Obsidian.Notice('Smart Connections: API key is valid');
          } else {
            new Obsidian.Notice(
              'Smart Connections: API key is not working as expected!',
            );
          }
        }),
      );
    // add dropdown to select the model
    new Obsidian.Setting(containerEl)
      .setName('Smart Chat Model')
      .setDesc('Select a model to use with Smart Chat.')
      .addDropdown((dropdown) => {
        dropdown.addOption('gpt-3.5-turbo-16k', 'gpt-3.5-turbo-16k');
        dropdown.addOption('gpt-4', 'gpt-4 (limited access, 8k)');
        dropdown.addOption('gpt-3.5-turbo', 'gpt-3.5-turbo (4k)');
        dropdown.onChange(async (value) => {
          this.plugin.settings.smart_chat_model = value;
          await this.plugin.saveSettings();
        });
        dropdown.setValue(this.plugin.settings.smart_chat_model);
      });
    // language
    new Obsidian.Setting(containerEl)
      .setName('Default Language')
      .setDesc(
        'Default language to use for Smart Chat. Changes which self-referential pronouns will trigger lookup of your notes.',
      )
      .addDropdown((dropdown) => {
        // get Object keys from pronous
        const languages = Object.keys(SMART_TRANSLATION);
        for (let i = 0; i < languages.length; i++) {
          dropdown.addOption(languages[i], languages[i]);
        }
        dropdown.onChange(async (value) => {
          this.plugin.settings.language = value;
          await this.plugin.saveSettings();
          self_ref_pronouns_list.setText(this.get_self_ref_list());
          // if chat view is open then run new_chat()
          const chat_view =
            this.app.workspace.getLeavesOfType(SMART_CONNECTIONS_CHAT_VIEW_TYPE)
              .length > 0
              ? this.app.workspace.getLeavesOfType(
                  SMART_CONNECTIONS_CHAT_VIEW_TYPE,
                )[0].view
              : null;
          if (chat_view) {
            chat_view.new_chat();
          }
        });
        dropdown.setValue(this.plugin.settings.language);
      });
    // list current self-referential pronouns
    const self_ref_pronouns_list = containerEl.createEl('span', {
      text: this.get_self_ref_list(),
    });
    containerEl.createEl('h2', {
      text: 'Exclusions',
    });
    // list file exclusions
    new Obsidian.Setting(containerEl)
      .setName('file_exclusions')
      .setDesc("'Excluded file' matchers separated by a comma.")
      .addText((text) =>
        text
          .setPlaceholder('drawings,prompts/logs')
          .setValue(this.plugin.settings.file_exclusions)
          .onChange(async (value) => {
            this.plugin.settings.file_exclusions = value;
            await this.plugin.saveSettings();
          }),
      );
    // list folder exclusions
    new Obsidian.Setting(containerEl)
      .setName('folder_exclusions')
      .setDesc("'Excluded folder' matchers separated by a comma.")
      .addText((text) =>
        text
          .setPlaceholder('drawings,prompts/logs')
          .setValue(this.plugin.settings.folder_exclusions)
          .onChange(async (value) => {
            this.plugin.settings.folder_exclusions = value;
            await this.plugin.saveSettings();
          }),
      );
    // list path only matchers
    new Obsidian.Setting(containerEl)
      .setName('path_only')
      .setDesc("'Path only' matchers separated by a comma.")
      .addText((text) =>
        text
          .setPlaceholder('drawings,prompts/logs')
          .setValue(this.plugin.settings.path_only)
          .onChange(async (value) => {
            this.plugin.settings.path_only = value;
            await this.plugin.saveSettings();
          }),
      );
    // list header exclusions
    new Obsidian.Setting(containerEl)
      .setName('header_exclusions')
      .setDesc(
        "'Excluded header' matchers separated by a comma. Works for 'blocks' only.",
      )
      .addText((text) =>
        text
          .setPlaceholder('drawings,prompts/logs')
          .setValue(this.plugin.settings.header_exclusions)
          .onChange(async (value) => {
            this.plugin.settings.header_exclusions = value;
            await this.plugin.saveSettings();
          }),
      );
    containerEl.createEl('h2', {
      text: 'Display',
    });
    // toggle showing full path in view
    new Obsidian.Setting(containerEl)
      .setName('show_full_path')
      .setDesc('Show full path in view.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.show_full_path)
          .onChange(async (value) => {
            this.plugin.settings.show_full_path = value;
            await this.plugin.saveSettings(true);
          }),
      );
    // toggle expanded view by default
    new Obsidian.Setting(containerEl)
      .setName('expanded_view')
      .setDesc('Expanded view by default.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.expanded_view)
          .onChange(async (value) => {
            this.plugin.settings.expanded_view = value;
            await this.plugin.saveSettings(true);
          }),
      );
    // toggle group nearest by file
    new Obsidian.Setting(containerEl)
      .setName('group_nearest_by_file')
      .setDesc('Group nearest by file.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.group_nearest_by_file)
          .onChange(async (value) => {
            this.plugin.settings.group_nearest_by_file = value;
            await this.plugin.saveSettings(true);
          }),
      );
    // toggle view_open on Obsidian startup
    new Obsidian.Setting(containerEl)
      .setName('view_open')
      .setDesc('Open view on Obsidian startup.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.view_open)
          .onChange(async (value) => {
            this.plugin.settings.view_open = value;
            await this.plugin.saveSettings(true);
          }),
      );
    // toggle chat_open on Obsidian startup
    new Obsidian.Setting(containerEl)
      .setName('chat_open')
      .setDesc('Open view on Obsidian startup.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.chat_open)
          .onChange(async (value) => {
            this.plugin.settings.chat_open = value;
            await this.plugin.saveSettings(true);
          }),
      );
    containerEl.createEl('h2', {
      text: 'Advanced',
    });
    // toggle log_render
    new Obsidian.Setting(containerEl)
      .setName('log_render')
      .setDesc('Log render details to console (includes token_usage).')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.log_render)
          .onChange(async (value) => {
            this.plugin.settings.log_render = value;
            await this.plugin.saveSettings(true);
          }),
      );
    // toggle files in log_render
    new Obsidian.Setting(containerEl)
      .setName('log_render_files')
      .setDesc('Log embedded objects paths with log render (for debugging).')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.log_render_files)
          .onChange(async (value) => {
            this.plugin.settings.log_render_files = value;
            await this.plugin.saveSettings(true);
          }),
      );
    // toggle skip_sections
    new Obsidian.Setting(containerEl)
      .setName('skip_sections')
      .setDesc(
        "Skips making connections to specific sections within notes. Warning: reduces usefulness for large files and requires 'Force Refresh' for sections to work in the future.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.skip_sections)
          .onChange(async (value) => {
            this.plugin.settings.skip_sections = value;
            await this.plugin.saveSettings(true);
          }),
      );
    // test file writing by creating a test file, then writing additional data to the file, and returning any error text if it fails
    containerEl.createEl('h3', {
      text: 'Test File Writing',
    });
    // manual save button
    containerEl.createEl('h3', {
      text: 'Manual Save',
    });
    let manual_save_results = containerEl.createEl('div');
    new Obsidian.Setting(containerEl)
      .setName('manual_save')
      .setDesc('Save current embeddings')
      .addButton((button) =>
        button.setButtonText('Manual Save').onClick(async () => {
          // confirm
          if (
            confirm('Are you sure you want to save your current embeddings?')
          ) {
            // save
            try {
              await this.plugin.saveEmbeddingsToFile(true);
              manual_save_results.innerHTML = 'Embeddings saved successfully.';
            } catch (e) {
              manual_save_results.innerHTML =
                'Embeddings failed to save. Error: ' + e;
            }
          }
        }),
      );

    // list previously failed files
    containerEl.createEl('h3', {
      text: 'Previously failed files',
    });
    let failed_list = containerEl.createEl('div');
    this.draw_failed_files_list(failed_list);

    // force refresh button
    containerEl.createEl('h3', {
      text: 'Force Refresh',
    });
    new Obsidian.Setting(containerEl)
      .setName('force_refresh')
      .setDesc(
        'WARNING: DO NOT use unless you know what you are doing! This will delete all of your current embeddings from OpenAI and trigger reprocessing of your entire vault!',
      )
      .addButton((button) =>
        button.setButtonText('Force Refresh').onClick(async () => {
          // confirm
          if (
            confirm(
              'Are you sure you want to Force Refresh? By clicking yes you confirm that you understand the consequences of this action.',
            )
          ) {
            // force refresh
            await this.plugin.forceRefreshEmbeddingsFile();
          }
        }),
      );
  }
  get_self_ref_list() {
    return (
      'Current: ' +
      SMART_TRANSLATION[this.plugin.settings.language].pronous.join(', ')
    );
  }

  draw_failed_files_list(failed_list) {
    failed_list.empty();
    if (this.plugin.settings.failed_files.length > 0) {
      // add message that these files will be skipped until manually retried
      failed_list.createEl('p', {
        text: 'The following files failed to process and will be skipped until manually retried.',
      });
      let list = failed_list.createEl('ul');
      for (let failed_file of this.plugin.settings.failed_files) {
        list.createEl('li', {
          text: failed_file,
        });
      }
      // add button to retry failed files only
      new Obsidian.Setting(failed_list)
        .setName('retry_failed_files')
        .setDesc('Retry failed files only')
        .addButton((button) =>
          button.setButtonText('Retry failed files only').onClick(async () => {
            // clear failed_list element
            failed_list.empty();
            // set "retrying" text
            failed_list.createEl('p', {
              text: 'Retrying failed files...',
            });
            await this.plugin.retry_failed_files();
            // redraw failed files list
            this.draw_failed_files_list(failed_list);
          }),
        );
    } else {
      failed_list.createEl('p', {
        text: 'No failed files',
      });
    }
  }
}
