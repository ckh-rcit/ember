# Ember

A web-based management interface for [Cloudflare Snippets](https://developers.cloudflare.com/rules/snippets/), built with SvelteKit and deployed on Cloudflare Pages.

Ember provides full CRUD operations for snippets and snippet rules across all zones in your Cloudflare account, with a built-in JavaScript code editor, structured rule expression builder, and import/export capabilities.

## Features

- Browse and select from all zones in your Cloudflare account
- Create, view, edit, rename, and delete snippets
- Integrated CodeMirror 6 editor with JavaScript syntax highlighting
- Visual field/operator/value rule expression builder or raw expression editing
- Bulk import and export snippets as JSON, or export individual snippets as `.js` files

## Tech Stack

- SvelteKit 2 with Svelte 5 (runes mode)
- Tailwind CSS 4
- CodeMirror 6
- TypeScript
- Cloudflare Pages

## Prerequisites

- [Bun](https://bun.sh/) 1.3 or later
- A Cloudflare API token (see [API Token Permissions](#api-token-permissions))

## Setup

1. Install dependencies:

   ```sh
   bun install
   ```

2. Create a `.env` file with your Cloudflare API token:

   ```
   CLOUDFLARE_API_TOKEN=your_token_here
   ```

3. Start the development server:

   ```sh
   bun run dev
   ```

## Deployment

Build and deploy to Cloudflare Pages:

```sh
bun run build
wrangler pages deploy .svelte-kit/cloudflare
```

Set the API token secret in your Pages project:

```sh
wrangler pages secret put CLOUDFLARE_API_TOKEN
```

## API Token Permissions

| Permission | Access |
| ---------- | ------ |
| Zone       | Read   |
| Snippets   | Write  |

## Project Structure

```
src/
  lib/
    cloudflare.ts        # Cloudflare API client
    types.ts             # TypeScript interfaces
    components/
      CodeEditor.svelte  # CodeMirror 6 wrapper component
  routes/
    +page.svelte         # Main application page
    +layout.svelte       # App shell and layout
    layout.css           # Global styles
    api/                 # Server-side API proxy routes
```

## License

MIT

