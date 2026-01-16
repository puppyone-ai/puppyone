# PuppyOne Documentation

This folder contains the documentation source code for PuppyOne, built with [Nextra](https://nextra.site).

## Getting Started

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start Development Server**
   ```bash
   npm run dev
   ```

3. **Open Browser**
   Visit [http://localhost:3000](http://localhost:3000) to view the documentation.

## Project Structure

- `pages/` - Contains markdown files that map to routes.
- `theme.config.jsx` - Configuration for the documentation theme.
- `next.config.js` - Next.js configuration.
- `_meta.json` - Defines the order and titles of sidebar items.

## Writing Documentation

Just create `.md` or `.mdx` files in the `pages` directory. They will be automatically added to the sidebar. Use `_meta.json` to customize the sidebar structure.

