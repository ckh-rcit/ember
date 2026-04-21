# Ember

A web-based management interface for [Cloudflare Snippets](https://developers.cloudflare.com/rules/snippets/), built with SvelteKit and deployed on Cloudflare Pages.

Ember provides full CRUD operations for snippets and snippet rules across all zones in your Cloudflare account, with a built-in JavaScript code editor, structured rule expression builder, and import/export capabilities.

## Features

- **Zone management** -- Browse and select from all zones in your Cloudflare account
- **Snippet CRUD** -- Create, view, edit, rename, and delete snippets
- **Code editor** -- Integrated CodeMirror 6 editor with JavaScript syntax highlighting
- **Rule expression builder** -- Visual field/operator/value builder or raw expression editing
- **Import/Export** -- Bulk import and export snippets as JSON, or export individual snippets as `.js` files
- **Dark theme** -- Purpose-built dark interface with orange-amber accent

## Tech Stack

- [SvelteKit](https://svelte.dev/) (Svelte 5, runes mode)
- [Tailwind CSS](https://tailwindcss.com/) v4
- [CodeMirror](https://codemirror.net/) 6
- [Cloudflare Pages](https://pages.cloudflare.com/) via `@sveltejs/adapter-cloudflare`
- [Bun](https://bun.sh/) as package manager and runtime

## Prerequisites

- [Bun](https://bun.sh/) >= 1.3
- A Cloudflare API token with **Snippets Write** and **Zone Read** permissions

## Setup

1. Clone the repository and install dependencies:

   ```sh
   cd ember
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

Ember is configured to deploy as a Cloudflare Pages project.

```sh
bun run build
```

The build output is written to `.svelte-kit/cloudflare/`. Deploy via Wrangler:

```sh
wrangler pages deploy .svelte-kit/cloudflare
```

Set the `CLOUDFLARE_API_TOKEN` secret in your Pages project:

```sh
wrangler pages secret put CLOUDFLARE_API_TOKEN
```

## Project Structure

```
src/
  lib/
    cloudflare.ts        # Cloudflare API client (zones, snippets, rules)
    types.ts             # TypeScript interfaces
    components/
      CodeEditor.svelte  # CodeMirror 6 wrapper component
  routes/
    +page.svelte         # Main SPA (manage + create tabs)
    +layout.svelte       # App shell and header
    layout.css           # Global dark theme styles
    api/                 # Server-side API proxy routes
      zones/             # Zone listing
      zones/[zoneId]/
        snippets/        # Snippet CRUD endpoints
        snippets/rules/  # Snippet rule endpoints
```

## API Token Permissions

The Cloudflare API token used by Ember requires the following permissions:

| Permission     | Access |
| -------------- | ------ |
| Zone           | Read   |
| Snippets       | Write  |

