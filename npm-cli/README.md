# @anonymoussysna/pm2-manager-cli

One-tap installer and launcher for `pm2-manager`.

## Usage

```bash
npx @anonymoussysna/pm2-manager-cli
```

Global install:

```bash
npm i -g @anonymoussysna/pm2-manager-cli
pm2-manager
```

Options:

- `--dir <path>` install/run directory (default `~/pm2-manager`)
- `--repo <url>` git repository URL
- `--logs` tail pm2 logs after start

## Publish

```bash
cd npm-cli
npm login
npm publish --access public
```
