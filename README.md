# Portfolio Website

A modern, animated portfolio for a product/UX designer, built with **React + Vite + Tailwind CSS v4** and **Framer Motion**.

## Sections

- **Hero** — intro, role, tagline, and social links
- **About** — bio and key stats
- **Work** — selected projects grid
- **Skills** — capabilities grouped by Design / Research / Tools

## Getting started

```bash
npm install
npm run dev      # start dev server (http://localhost:5173)
npm run build    # production build into /dist
npm run preview  # preview the production build
```

## Customizing

All content lives in **`src/data.js`** — edit your name, role, projects, and
skills there. Colors and fonts are defined as theme tokens in
**`src/index.css`** (`@theme` block).

## Structure

```
src/
  components/   Nav, Hero, About, Projects, Skills, Footer, Reveal
  data.js       all editable content
  index.css     Tailwind import + theme tokens
  App.jsx       page composition
```
