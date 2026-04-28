# Steno documentation

This directory contains the Mintlify documentation site for Steno.

## Connecting to Mintlify

1. Create a free account at [mintlify.com](https://mintlify.com)
2. Create a new project and connect this GitHub repository
3. Set the **docs directory** to `/docs`
4. Mintlify will deploy to `[your-project].mintlify.app` — you can then add a custom domain (e.g. `docs.stenoai.co`) in the Mintlify dashboard

That's it. Mintlify reads `mint.json` for configuration and the `.mdx` files for content.

## Local preview

```bash
npm install -g mintlify
cd docs
mintlify dev
```

## Structure

```
docs/
├── mint.json                      Mintlify config, navigation, theme
├── custom.css                     Steno design system tokens
├── logo/                          Brand assets (mark + wordmark)
├── getting-started/               Installation and quick start
├── features/                      Feature documentation
├── privacy/                       On-device processing and use cases
├── models/                        Transcription and summarization model guides
├── compare/                       Comparison pages (local vs cloud, vs Otter, vs Fireflies)
└── faq.mdx                        Frequently asked questions
```
