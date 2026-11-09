---
title: Markdown style guide
subtitle: Every element an essay can use, so you can check how they look.
date: 2026-11-08
draft: true
---

This post is a draft: it shows up while you run `npm run dev`, but not on the live site. Use it to check how everything looks.

Paragraphs can hold *emphasis*, **strong text**, [inline links](https://example.com), `inline code`, and a footnote reference.[^1]

## A second-level heading

Headings show their markdown marker in a lighter colour.

> A blockquote sits indented, in italics, behind a thin rule.

### A third-level heading

- Unordered list item
- Another item, which can wrap onto a second line when it runs long enough to need one
- A third item

1. Ordered list item
2. Second step
3. Third step

```js
// a fenced code block
function greet(name) {
  return `hello, ${name}`;
}
```

| Column | Column | Value |
| ------ | ------ | ----: |
| cell   | cell   |     1 |
| cell   | cell   |     2 |

---

A horizontal rule (`---`) appears as three spaced asterisks.

[^1]: Footnotes collect at the bottom of the post.
