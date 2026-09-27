import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown} from '../runtime/markdown.mjs';

test('renders headings, emphasis, lists, quotes, tables and literal fenced code', () => {
  const html = renderMarkdown('# 方案\n\n**结论** 与 `变量`\n\n1. 先验证\n2. 再发布\n\n> 前提\n\n| 方案 | 条件 |\n| --- | --- |\n| A | 可恢复 |\n\n```js\nconst x = "<script>";\n```');
  for (const tag of ['h1','strong','ol','li','blockquote','table','th','td','pre','code']) assert.match(html,new RegExp(`<${tag}(?:>| )`));
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /class="table-scroll"/);
});

test('raw HTML and script-bearing URLs remain inert, including encoded protocols', () => {
  for (const source of ['<img src=x onerror=alert(1)>','<script>alert(1)</script>', '<svg onload=alert(1)>', '<iframe src="https://example.org"></iframe>']) {
    const html=renderMarkdown(source); assert.doesNotMatch(html,/<(?:img|script|svg|iframe)\b/i);assert.match(html,/&lt;/);
  }
  for (const href of ['javascript:alert%281%29','jav&#x61;script:alert%281%29','data:text/html,hello','file:///etc/passwd','//example.org','/clear?token=test','#settings']) {
    assert.doesNotMatch(renderMarkdown(`[link](${href})`),/<a\b/i,href);
  }
  assert.doesNotMatch(renderMarkdown('```" onmouseover="alert(1)\ntext\n```'), / onmouseover="/);
});

test('web links isolate the opener and referrer, images do not fetch resources', () => {
  const html=renderMarkdown('[文档](https://example.org/doc?q=1&x=2)\n\n![**说明** <img>](https://example.org/tracker.svg)');
  assert.match(html,/target="_blank"/);assert.match(html,/rel="noopener noreferrer"/);
  assert.match(html,/href="https:\/\/example.org\/doc\?q=1&amp;x=2"/);
  assert.doesNotMatch(html,/<img\b|src=|tracker\.svg/);assert.match(html,/图片：说明 &lt;img&gt;/);
});

test('diagram fences and plain text remain readable without an execution engine', () => {
  assert.match(renderMarkdown('```mermaid\ngraph LR\nA-->B\n```'), /<code class="language-mermaid">graph LR/);
  assert.match(renderMarkdown('第一段\n\n第二段'), /<p>第一段<\/p>\n<p>第二段<\/p>/);
  assert.equal(renderMarkdown(undefined),'');
});
