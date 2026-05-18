# AGENTS.md — Sentinel

## Project Context

Sentinel is a clinical pharmacology assistant built on Cloudflare Workers. It provides drug information, FDA label data, clinical pharmacology insights via "Nurse Clippy" — an AI assistant for registered nurses. Stack: Cloudflare Workers (TypeScript) + D1 + Workers AI + AI Search + Vite/React frontend.

**Deployment:** sentinel-api.kodakwest.workers.dev
**Repo:** kodakwest/sentinel

## Design Conventions

### Visual Identity
- **Dark theme** — background `#0e0f0d` / `#0b0d0e`, panels `#171713`, ink `#e8e6e1`
- **Accent:** Coral/rose for medical — `#e07d5f` primary, `#fb7185` secondary
- **Fonts:** Inter (UI), JetBrains Mono (code), loaded from Google Fonts
- **No build step** — pure HTML/CSS/JS, zero dependencies, works offline

### HTML Artifact Standards
- Single `.html` file, all CSS and SVG inline
- No external dependencies except Google Fonts
- Mobile-responsive via CSS media queries
- Must render in any modern browser
- Dark theme, coral accent, clean clinical feel

### Brand Elements
- **Persona:** Nurse Clippy — direct, clinically precise, no fluff. Speaks like an experienced nurse educator.
- **Tone:** Trustworthy, clinical, warm-but-professional
- **Medical precision** — this is a nursing reference tool, not consumer health

## Graph Seed Protocol — MANDATORY for all durable docs

YAML frontmatter with artifact_type, source_context, domain, systems, primary_entities, last_updated. Entity relationship format at end.

## Architecture Diagram Colors (SVG)
| Component | Fill | Stroke |
|---|---|---|
| Frontend | rgba(136, 19, 55, 0.4) | #fb7185 |
| Backend/API | rgba(6, 78, 59, 0.4) | #34d399 |
| Database | rgba(76, 29, 149, 0.4) | #a78bfa |
| AI/ML | rgba(251, 146, 60, 0.3) | #fb923c |
| External/FDA | rgba(30, 41, 59, 0.5) | #94a3b8 |
