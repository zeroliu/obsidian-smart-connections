import builtins from 'builtin-modules';
import esbuild from 'esbuild';
import fs from 'fs';
const packageJson = JSON.parse(fs.readFileSync('./package.json'));
const manifestJson = JSON.parse(fs.readFileSync('./manifest.json'));
manifestJson.version = packageJson.version;
// fs.writeFileSync('./manifest.json', JSON.stringify(manifestJson, null, 2));
// fs.writeFileSync('./dist/manifest.json', JSON.stringify(manifestJson, null, 2));

// Copy styles.css to dist folder
fs.copyFileSync('./src/styles.css', './styles.css');

const prod = process.argv[2] === 'production';

// Build the project
const context = await esbuild
  .context({
    entryPoints: ['src/index.ts'],
    outfile: './main.js',
    format: 'cjs',
    bundle: true,
    write: true,
    sourcemap: 'inline',
    target: 'es2018',
    logLevel: 'info',
    treeShaking: true,
    external: [
      'obsidian',
      'electron',
      '@codemirror/autocomplete',
      '@codemirror/collab',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/lint',
      '@codemirror/search',
      '@codemirror/state',
      '@codemirror/view',
      '@lezer/common',
      '@lezer/highlight',
      '@lezer/lr',
      ...builtins,
    ],
  })
  .catch(() => process.exit(1));

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
