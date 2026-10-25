# 003: Templates are HTML + Handlebars only

## Context
v1 shipped with both MJML and HTML template formats. Having two formats made the editor, the AI assistant and the gallery more complex than the product needs.

## Decision
- New and edited template versions, layouts and AI drafts are **HTML + Handlebars** only. The API rejects `format: "mjml"` on save.
- MJML is legacy and render-only:
  - The renderer still compiles stored MJML versions, so existing templates keep sending unchanged.
  - Preview still shows them.
- `POST /templates/:id/convert-html` compiles a legacy template, and its MJML layout if any, into one HTML version.
  - Every `{{variable}}` is kept.
  - The template is detached from the old layout.
  - The editor shows a **Convert to HTML** banner for legacy templates.
- The seed now creates an HTML `Default` layout and HTML gallery templates. On existing databases it:
  - renames the old MJML layout to `Default (MJML, legacy)`, so templates that still use it keep working;
  - adds an HTML version to each MJML gallery template.
- The `mjml` package and the `TemplateFormat` enum value stay until no stored versions use MJML. No destructive migration is needed.

## Why
One format is simpler to edit, generate and support. HTML with inline styles is what every provider sends anyway. Keeping MJML render-only avoids breaking existing templates.
