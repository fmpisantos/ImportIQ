---
title: Persist search filters in the URL
created: 2026-06-10
status: todo
priority: low
---

## What
Reflect the active search filters in the page URL (query string) so searches are
shareable, bookmarkable, and survive a refresh / back-button.

## Why
Listed in README "Known gaps". Useful once saved searches/alerts exist, and makes
debugging a specific search trivial (paste the URL).

## Notes
- Frontend: `web/src/pages/SearchPage.jsx` + `components/FilterForm.jsx`.
- Sync `FilterForm` state ↔ `useSearchParams` (react-router is already used).
