import MarkdownIt from 'markdown-it';
import {diagramProblem} from './diagram.mjs';

// No raw HTML, embedded media, highlighting plugins, or remote resources.
const md = new MarkdownIt({html:false, linkify:false, typographer:false});
md.validateLink = href => /^https?:\/\//i.test(href);
md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return renderer.renderToken(tokens, index, options);
};
md.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const label = renderer.renderInlineAsText(tokens[index].children ?? [], options, env);
  return `<span class="image-description">[图片：${md.utils.escapeHtml(label || '未附说明')}]</span>`;
};
md.renderer.rules.table_open = () => '<div class="table-scroll" tabindex="0" role="region" aria-label="表格，可横向滚动"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';
const fence=md.renderer.rules.fence;
md.renderer.rules.fence=(tokens,index,options,env,renderer)=>{
  const token=tokens[index];
  if(token.info.trim()!=='mermaid')return fence(tokens,index,options,env,renderer);
  const problem=diagramProblem(token.content);
  const code=`<pre><code class="language-mermaid">${md.utils.escapeHtml(token.content)}</code></pre>`;
  if(problem)return `<p class="diagram-note">${problem}</p>${code}`;
  return `<figure class="diagram"><div class="diagram-output">正在绘制图示…</div><details open><summary>图示源码</summary>${code}</details></figure>`;
};

export function renderMarkdown(source) {
  const text = typeof source === 'string' ? source : '';
  try { return md.render(text); }
  catch { return `<pre>${md.utils.escapeHtml(text)}</pre>`; }
}

// Changes to rendering also invalidate any running old panel daemon.
export const rendererVersion = 'markdown-it-15.0.2-policy-1';
