import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

export function diagramProblem(source) {
  if(typeof source!=='string'||source.length>6000||source.split('\n').length>120)
    return '图示较大，请查看源码。';
  if(/%%\s*\{|^\s*---|^\s*click\s/im.test(source)) return '图示包含自定义配置或交互，请查看源码。';
  const first=source.split('\n').map(line=>line.trim()).find(line=>line&&!line.startsWith('%%'))??'';
  if(!/^(?:(?:graph|flowchart)\s+(?:TB|TD|BT|LR|RL)\b|sequenceDiagram\b)/.test(first))
    return '此图种暂未支持，请查看源码。';
  return null;
}

// Static, token-free sandbox page. Records are never embedded in its URL or HTML.
export const diagramHtml='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;padding:8px;font:16px system-ui;background:white;overflow:auto}svg{max-width:100%;height:auto}</style><div id="diagram"></div><script src="/mermaid.js"></script><script src="/diagram.js"></script></html>';
export const diagramCsp="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts";

function sandboxClient(problem) {
  let used=false;
  window.addEventListener('message',async event=>{
    if(used||event.source!==parent||event.data?.type!=='shutong-render')return;
    used=true;const {source,id}=event.data;
    const reply=data=>parent.postMessage({type:'shutong-diagram',id,...data},'*');
    if(problem(source)){reply({ok:false});return;}
    try {
      mermaid.initialize({startOnLoad:false,securityLevel:'strict',maxTextSize:6000,maxEdges:100,
        suppressErrorRendering:true,fontFamily:'system-ui',theme:'neutral',htmlLabels:false,
        flowchart:{htmlLabels:false},secure:['securityLevel','maxTextSize','maxEdges','startOnLoad']});
      const {svg}=await mermaid.render('renderedDiagram',source);
      const container=document.getElementById('diagram');container.innerHTML=svg;
      // Diagrams are visual only, with no active navigation or embedded content.
      container.querySelectorAll('script,foreignObject,iframe,image,a,use').forEach(node=>node.remove());
      for(const node of container.querySelectorAll('*'))for(const attribute of [...node.attributes])
        if(/^on/i.test(attribute.name)||/^(?:href|xlink:href)$/i.test(attribute.name))node.removeAttribute(attribute.name);
      reply({ok:true,height:Math.ceil(container.getBoundingClientRect().height)+24});
    }catch {document.getElementById('diagram').replaceChildren();reply({ok:false});}
  });
}
export const diagramClient=`(${sandboxClient.toString()})(${diagramProblem.toString()});`;

export function mountDiagrams(target) {
  for(const figure of target.querySelectorAll('figure.diagram')) {
    const output=figure.querySelector('.diagram-output'),source=figure.querySelector('code').textContent;
    const disclosure=figure.querySelector('details');
    if(document.querySelectorAll('iframe.shutong-diagram').length>=4){output.textContent='本页图示较多，其余以源码显示。';continue;}
    const frame=document.createElement('iframe');frame.className='shutong-diagram';frame.title='图示';
    frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('referrerpolicy','no-referrer');
    const id=crypto.randomUUID();let finished=false;
    const finish=(ok,height)=>{
      if(finished)return;finished=true;clearTimeout(timer);window.removeEventListener('message',receive);
      if(!figure.isConnected){frame.remove();return;}
      if(ok){frame.style.height=Math.min(800,Math.max(120,height||240))+'px';disclosure.open=false;}
      else {frame.remove();output.textContent='图示未能显示，仍可查看源码。';disclosure.open=true;}
    };
    const receive=event=>{
      if(event.source!==frame.contentWindow||event.data?.type!=='shutong-diagram'||event.data.id!==id)return;
      finish(event.data.ok===true,Number(event.data.height));
    };
    const timer=setTimeout(()=>finish(false),10000);
    window.addEventListener('message',receive);
    frame.onload=()=>frame.contentWindow?.postMessage({type:'shutong-render',source,id},'*');
    frame.onerror=()=>finish(false);frame.src='/diagram';output.replaceChildren(frame);
  }
}

let library;
export async function diagramLibrary() {
  if(!library)library=readFile(new URL('./mermaid.tiny.js',import.meta.url),'utf8')
    .catch(error=>{if(error.code!=='ENOENT')throw error;return readFile(createRequire(import.meta.url).resolve('@mermaid-js/tiny'),'utf8');});
  return library;
}
export const diagramVersion='tiny-12.0.0-policy-1';
