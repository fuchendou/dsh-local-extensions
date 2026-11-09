window.__ModuleLoader__.load({id:"dsh-office-kit",factory:(require)=>{var module={exports:{}};var exports=module.exports;
Object.defineProperty(exports,Symbol.toStringTag,{value:`Module`});let e=require("@deepseek-ai/dsh-client-ui-primitives"),t=require("react"),n=require("react/jsx-runtime");const r=[{id:`documents`,label:`Documents`,description:`Create, edit, render, and verify Word documents (.docx).`,hint:`DOCX`,skill:`office-documents`,command:`documents`,extensions:[`.docx`]},{id:`pdf`,label:`PDF`,description:`Create, read, edit, render, and verify PDF files.`,hint:`PDF`,skill:`office-pdf`,command:`pdf`,extensions:[`.pdf`]},{id:`presentations`,label:`Presentations`,description:`Create, edit, render, and verify slide decks (.pptx).`,hint:`PPTX`,skill:`office-presentations`,command:`presentations`,extensions:[`.pptx`]},{id:`spreadsheets`,label:`Spreadsheets`,description:`Create, edit, recalculate, render, and verify workbooks (.xlsx).`,hint:`XLSX`,skill:`office-spreadsheets`,command:`spreadsheets`,extensions:[`.xlsx`]}];function i(e){return r.find(t=>t.id===e)}function a(e){return r.find(t=>t.command===e)}const o=`dsh-office-kit`,s=`office`,c=`office`,l=`conversation.user.text.node`,u=`sidebar.right.tab.document.actions`,d=`officeAnnotation`,f=`<office-annotations>`,p=`</office-annotations>`,m=`canvas[role="img"][aria-label]`,h=`canvas.fortune-sheet-canvas`,g=2e4;function _(e,t){return e.replace(/\{(\w+)\}/gu,(e,n)=>t[n]??e)}function v(e){let t=[];for(let n of e.replace(/\r\n?/gu,`
`).split(`
`)){let e=n.replace(/\s+/gu,` `).trim();e.length>0&&t.push(e)}return t.join(`
`)}function y(e,t){let n=Math.min(e.left,t.left),r=Math.min(e.top,t.top);return{left:n,top:r,width:Math.max(e.left+e.width,t.left+t.width)-n,height:Math.max(e.top+e.height,t.top+t.height)-r}}function b(e,t){let n=Math.max(e.left,t.left),r=Math.max(e.top,t.top),i=Math.min(e.left+e.width,t.left+t.width)-n,a=Math.min(e.top+e.height,t.top+t.height)-r;return i>0&&a>0?{left:n,top:r,width:i,height:a}:void 0}function ee(e,t){return b({left:e.left-3,top:e.top-3,width:e.width+6,height:e.height+6},t)}function x(e,t,n){return t>=e.left&&t<=e.left+e.width&&n>=e.top&&n<=e.top+e.height}function S(e,t,n){return{left:Math.max(8,Math.min(e.left,n.width-t.width-8)),top:Math.max(8,Math.min(e.top>=t.height+8?e.top-t.height:e.top+e.height,n.height-t.height-8))}}function te(e,t,n){let r;for(let i of e){let e=i.box;(i.rects??[e]).some(e=>t>=e.left-8&&t<=e.left+e.width+8&&n>=e.top-4&&n<=e.top+e.height+4)&&(!r||e.width*e.height<r.box.width*r.box.height)&&(r=i)}return r}function C(e){let t=[];for(let n of[...e].sort((e,t)=>e.box.top-t.box.top||e.box.left-t.box.left)){if(!n.text.trim()||n.box.width<=0||n.box.height<=0)continue;let e=t.find(e=>Math.abs(e.box.top-n.box.top)<Math.min(e.box.height,n.box.height)*.45&&n.box.left>=e.box.left&&n.box.left-(e.box.left+e.box.width)<n.box.height*2);e?(e.text+=` ${n.text}`,e.box=y(e.box,n.box),e.rects.push(n.box)):t.push({text:n.text,box:n.box,rects:[n.box]})}let n=[];for(let e of t){let t=n.findLast(t=>{let n=e.box.top-(t.last.top+t.last.height),r=Math.min(t.last.left+t.last.width,e.box.left+e.box.width)-Math.max(t.last.left,e.box.left);return n>=-e.box.height*.2&&n<=Math.min(t.last.height,e.box.height)*.7&&r>0&&Math.abs(t.last.left-e.box.left)<e.box.height*2&&Math.max(t.last.height,e.box.height)/Math.min(t.last.height,e.box.height)<1.4});t?(t.text+=`\n${e.text}`,t.box=y(t.box,e.box),t.rects.push(...e.rects),t.last=e.box):n.push({...e,last:e.box})}return n.map(({text:e,box:t,rects:n})=>({text:v(e),box:t,rects:n}))}function ne(e){let t=e.parentElement;if(!t)return[];let n=document.createTreeWalker(t,NodeFilter.SHOW_TEXT),r=[];for(let e=n.nextNode();e;e=n.nextNode()){if(!e.textContent?.trim())continue;let t=document.createRange();t.selectNodeContents(e);let n=t.getBoundingClientRect();n.width>0&&n.height>0&&r.push({text:e.textContent,box:{left:n.left,top:n.top,width:n.width,height:n.height}})}return C(r)}function re(e){let t=e.parentElement;for(;t&&getComputedStyle(t).display===`contents`;)t=t.parentElement;return t?.parentElement?{header:t,root:t.parentElement}:void 0}function ie(e,t,n){let r=[...e.querySelectorAll(m)],i=r.findIndex(e=>x(e.getBoundingClientRect(),t,n)&&e.getBoundingClientRect().width>0);return i<0?void 0:{canvas:r[i],page:i+1}}function ae(e,t,n){let r=[...e.querySelectorAll(h)].find(e=>x(e.getBoundingClientRect(),t,n)&&e.getBoundingClientRect().width>0);return r?{canvas:r}:void 0}function w(e,t){if(t.width<=0||t.height<=0)throw Error(`annotation.emptyPage`);let n=b(e,t);if(!n)throw Error(`annotation.emptyRegion`);return{left:(n.left-t.left)/t.width,top:(n.top-t.top)/t.height,width:n.width/t.width,height:n.height/t.height}}async function oe(e,t,n=4e6,r=1/0){let i=e.canvas;if(!i||i.width<=0||i.height<=0)throw Error(`annotation.captureFailed`);let a=i.getBoundingClientRect(),o=e.region??w(e.box,a),s=i.width*o.width,c=i.height*o.height,l=Math.min(1,Math.sqrt(n/(s*c)),r/s,r/c);if(!Number.isFinite(l)||l<=0)throw Error(`annotation.captureFailed`);let u=document.createElement(`canvas`);u.width=Math.max(1,Math.floor(s*l)),u.height=Math.max(1,Math.floor(c*l));let d=u.getContext(`2d`);if(!d)throw Error(`annotation.captureFailed`);d.drawImage(i,o.left*i.width,o.top*i.height,s,c,0,0,u.width,u.height);let f=await new Promise((e,t)=>u.toBlob(n=>n?e(n):t(Error(`annotation.captureFailed`)),`image/png`));return new File([f],t,{type:`image/png`})}function T(e){if(typeof e!=`object`||!e)return!1;let t=e,n=(e,t)=>typeof e==`string`&&e.length<=t;if(!n(t.target,2e4)||!n(t.fileName,1e3)||!n(t.text,2e4)||!n(t.requirement,2e4)||!t.requirement.trim()||t.page!==void 0&&(!Number.isSafeInteger(t.page)||t.page<1)||t.imageName!==void 0&&!n(t.imageName,1e3)||t.sheet!==void 0&&(!n(t.sheet,1e3)||!t.sheet.trim())||t.range!==void 0&&(!n(t.range,100)||!t.range.trim())||t.unmapped!==void 0&&t.unmapped!==!0)return!1;if(t.region!==void 0){let e=t.region;if(!e||![`left`,`top`,`width`,`height`].every(t=>typeof e[t]==`number`&&Number.isFinite(e[t])&&e[t]>=0&&e[t]<=1)||e.width<=0||e.height<=0||e.left+e.width>1.000001||e.top+e.height>1.000001)return!1}return!0}function E(e){if(!e.length||e.length>50||!e.every(T))throw Error(`annotation.invalid`);let t=JSON.stringify(e).replace(/</gu,`\\u003c`);if(t.length>12e5)throw Error(`annotation.tooLarge`);return`${f}\n${t}\n${p}`}const D={id:d,order:10,match(e,t){for(let n=e.indexOf(f,t);n>=0;n=e.indexOf(f,n+20)){let t=e.indexOf(p,n+20);if(t<0)return;let r=e.slice(n+20,t).trim();if(!(r.length>12e5))try{let e=JSON.parse(r);if(Array.isArray(e)&&e.length>0&&e.length<=50&&e.every(T))return{id:d,start:n,end:t+21,data:{items:e}}}catch{}}}};function se({items:e,inputActions:t,intake:n,limits:r,existingImages:i,deferSubmit:a}){let o=E(e.map(e=>e.annotation)),s=e.flatMap(e=>e.file?[e.file]:[]);if(s.length&&!n)throw Error(`annotation.intakeUnavailable`);if(s.length&&r&&(s.some(e=>!r.mediaTypes.includes(e.type)||e.size>r.maxImageBytes)||i.length+s.length>r.maxImagesPerMessage||[...i,...s].reduce((e,t)=>e+t.size,0)>r.maxMessageImageBytes))throw Error(`annotation.imageLimit`);let c=t.captureInsertion(),l=s.length?n.create(s):[];if(l.length&&!t.addAttachments(l.map(e=>e.id)))throw n.release(l),Error(`annotation.sendFailed`);if(!t.insertText(`\n${o}\n`,{...c,start:c.end})){for(let e of l)t.removeAttachment(e.id);throw n?.release(l),Error(`annotation.sendFailed`)}try{return t.persistDraft(),a?`draft`:(t.submit(),`sent`)}catch{return`draft`}}function ce({node:e,interactive:r,openAnnotation:i,t:a}){let o=(0,t.useId)(),s=(0,t.useRef)(null),c=(0,t.useRef)(null),[l,u]=(0,t.useState)(!1),d=_(a(`annotation.count`),{count:String(e.data.items.length)});return(0,t.useLayoutEffect)(()=>{let e=c.current,t=s.current;if(!e||!t)return;if(!l){e.hidePopover?.();return}e.showPopover?.();let n=()=>{let n={width:document.documentElement.clientWidth,height:window.innerHeight},{left:r,top:i}=S(t.getBoundingClientRect(),e.getBoundingClientRect(),n);e.style.left=`${r}px`,e.style.top=`${i}px`},r=t=>{t.target instanceof Node&&e.contains(t.target)||u(!1)},i=new ResizeObserver(n);return i.observe(t),i.observe(e),window.addEventListener(`resize`,n),document.addEventListener(`scroll`,r,!0),n(),()=>{e.hidePopover?.(),i.disconnect(),window.removeEventListener(`resize`,n),document.removeEventListener(`scroll`,r,!0)}},[l]),(0,n.jsxs)(`span`,{ref:s,className:`dsh-office-annotation-reference`,onPointerEnter:()=>u(!0),onPointerLeave:e=>{(!(e.relatedTarget instanceof Node)||!e.currentTarget.contains(e.relatedTarget))&&u(!1)},onFocus:()=>u(!0),onBlur:e=>{e.currentTarget.contains(e.relatedTarget)||u(!1)},onKeyDown:e=>{e.key===`Escape`&&(e.preventDefault(),e.stopPropagation(),c.current?.contains(e.target)&&s.current?.querySelector(`button`)?.focus(),u(!1))},children:[(0,n.jsx)(`button`,{type:`button`,id:`${o}-trigger`,"aria-haspopup":`dialog`,"aria-controls":o,"aria-expanded":l,children:d}),(0,n.jsx)(`span`,{ref:c,popover:`manual`,className:`dsh-office-annotation-popover`,"data-open":l,id:o,role:`dialog`,"aria-labelledby":`${o}-trigger`,children:(0,n.jsx)(`span`,{className:`dsh-office-annotation-list`,children:e.data.items.map((e,t)=>(0,n.jsxs)(`span`,{className:`dsh-office-annotation-item`,children:[(0,n.jsx)(`span`,{className:`dsh-office-annotation-source`,children:r?(0,n.jsx)(`button`,{type:`button`,onClick:()=>i(e.target),title:e.target,children:e.fileName}):(0,n.jsx)(`span`,{children:e.fileName})}),(0,n.jsx)(`span`,{className:`dsh-office-annotation-requirement`,children:e.requirement})]},t))})})]})}function O(e){return/\.(?:pdf|docx?|pptx|xlsx)$/iu.test(e.absolutePath)?(0,n.jsx)(le,{...e},e.absolutePath):null}function le({absolutePath:e,pendingAnnotations:r,intake:i,inputActions:a,useInput:o,useProjection:s,t:c}){let l=(0,t.useRef)(null),u=(0,t.useRef)(null),d=(0,t.useRef)(null),f=(0,t.useRef)(),[p,v]=(0,t.useState)(),[y,x]=(0,t.useState)(!1),[S,C]=(0,t.useState)(),[T,E]=(0,t.useState)(),[D,ce]=(0,t.useState)(``),[O,le]=(0,t.useState)(),[k,A]=(0,t.useState)(!1),[j,M]=(0,t.useState)(!1),[N,P]=(0,t.useState)(()=>r.get(e)??[]),[F,I]=(0,t.useState)(!1),L=(0,t.useId)(),[R,z]=(0,t.useState)(``),B=o(e=>e),V=s(`imageLimits`),ue=/\.pdf$/iu.test(e),H=/\.xlsx$/iu.test(e),U=ue||H,W=H?h:m,G=e.replace(/\\/gu,`/`).split(`/`).pop()??e,K=(0,t.useRef)(0),q=(0,t.useRef)(),J=(0,t.useRef)(),Y=(0,t.useRef)(),de=B.phase!==`plain`;(0,t.useEffect)(()=>{N.length?r.set(e,N):r.delete(e)},[e,N,r]);function X(){K.current++,E(void 0),le(void 0),A(!1),ce(``)}function Z(){clearTimeout(q.current),J.current=void 0,M(!1),C(void 0)}(0,t.useEffect)(()=>{let e=l.current,t=e&&re(e);if(!t)return;let{header:n,root:r}=t;f.current=r;let i=0,a=()=>{cancelAnimationFrame(i),i=requestAnimationFrame(()=>{Y.current=void 0;let e=r.getBoundingClientRect(),t=Math.max(e.top,n.getBoundingClientRect().bottom,0),i=Math.min(e.bottom,window.innerHeight),a=Math.max(0,e.left),o=Math.min(e.right,window.innerWidth),s=[...r.querySelectorAll(W)].find(e=>e.getBoundingClientRect().width>0),c=r.isConnected&&!r.closest(`[hidden], [aria-hidden="true"]`)&&getComputedStyle(r).visibility===`visible`;v(c&&e.height>40&&s&&o>a&&i>t?{left:a,top:t,width:o-a,height:i-t}:void 0),E(e=>{if(!e?.canvas||!e.region)return e;let t=e.canvas.getBoundingClientRect(),n=e.region,r={left:t.left+n.left*t.width,top:t.top+n.top*t.height,width:n.width*t.width,height:n.height*t.height};return Object.keys(r).every(t=>r[t]===e.box[t])?e:{...e,box:r}})})},o=new ResizeObserver(a);o.observe(r);let s=new MutationObserver(t=>{t.some(t=>!e.contains(t.target))&&a()});s.observe(r,{childList:!0,subtree:!0,attributes:!0,attributeFilter:[`hidden`,`aria-hidden`,`class`,`style`]});for(let e=r.parentElement;e;e=e.parentElement)s.observe(e,{attributes:!0});return window.addEventListener(`resize`,a),r.addEventListener(`transitionend`,a),r.addEventListener(`scroll`,a,!0),a(),()=>{K.current++,clearTimeout(q.current),cancelAnimationFrame(i),o.disconnect(),s.disconnect(),window.removeEventListener(`resize`,a),r.removeEventListener(`transitionend`,a),r.removeEventListener(`scroll`,a,!0),f.current=void 0}},[]),(0,t.useEffect)(()=>{if(!T)return;let e=e=>{e.target instanceof Node&&!u.current?.contains(e.target)&&X()};return document.addEventListener(`pointerdown`,e,!0),u.current?.querySelector(`input`)?.focus(),()=>{document.removeEventListener(`pointerdown`,e,!0)}},[T]),(0,t.useEffect)(()=>{y&&d.current?.focus()},[y]);function fe(e,t){let n=f.current;if(!n)return;let r=n.querySelector(W)?.parentElement;for(;r&&r!==n&&!/auto|scroll/u.test(getComputedStyle(r).overflowY);)r=r.parentElement;r?.scrollBy({left:e,top:t}),C(void 0)}(0,t.useEffect)(()=>{let e=d.current;if(!y||!e||!p)return;let t=e=>{e.preventDefault();let t=e.deltaMode===1?16:e.deltaMode===2?p.height:1;fe(e.deltaX*t,e.deltaY*t)};return e.addEventListener(`wheel`,t,{passive:!1}),()=>e.removeEventListener(`wheel`,t)},[y,p]);function pe(e,t){let n=f.current;if(n)return H?ae(n,e,t):ie(n,e,t)}function me(e,t){if(H||!f.current)return;let n=ie(f.current,e,t);if(!n)return;let r=n.canvas.getBoundingClientRect();(Y.current?.canvas!==n.canvas||Y.current.box.left!==r.left||Y.current.box.top!==r.top||Y.current.box.width!==r.width||Y.current.box.height!==r.height)&&(Y.current={canvas:n.canvas,box:r,paragraphs:ne(n.canvas)});let i=te(Y.current.paragraphs,e,t);return i?{...i,...n}:void 0}function he(e,t){let n=J.current;if(!n)return;let r=b({left:Math.min(n.x,e),top:Math.min(n.y,t),width:Math.abs(e-n.x),height:Math.abs(t-n.y)},n.canvas.getBoundingClientRect());if(!r)return;let i=Y.current?.canvas===n.canvas?Y.current.paragraphs:ne(n.canvas),a=H?``:i.filter(e=>(e.rects??[e.box]).some(e=>b(e,r))).map(e=>e.text).join(`
`).slice(0,g);return{canvas:n.canvas,page:n.page,box:r,region:w(r,n.canvas.getBoundingClientRect()),text:a}}function ge(e){if(e.button!==0||!f.current||U&&!i)return;let t=pe(e.clientX,e.clientY);if(!t)return;e.preventDefault(),X();let n={...t,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,region:!1};J.current=n,e.currentTarget.setPointerCapture(e.pointerId),q.current=setTimeout(()=>{J.current===n&&(n.region=!0,M(!0),C(he(n.lastX,n.lastY)))},350)}function _e(e){let t=J.current;t&&(t.lastX=e.clientX,t.lastY=e.clientY,!t.region&&Math.hypot(e.clientX-t.x,e.clientY-t.y)>=6&&(clearTimeout(q.current),t.region=!0,M(!0))),C(t?.region?he(e.clientX,e.clientY):me(e.clientX,e.clientY))}async function ve(e){X();let t=K.current;z(``);let n=e.canvas?.getBoundingClientRect(),r=n?ee(e.box,n):e.box;if(!r)return;let i=n?w(r,n):e.region,a={...e,box:r,region:i};if(E(a),U){A(!0);try{let n=e.page===void 0?`region`:`p${e.page}`,r=await oe(a,`${G}-${n}-${Date.now()}.png`,V?.maxImagePixels,V?.maxImageDimension);K.current===t&&le(r)}catch{K.current===t&&z(c(`annotation.captureFailed`))}finally{K.current===t&&A(!1)}}}function ye(e){let t=J.current;if(clearTimeout(q.current),!t)return;let n=t.region?he(e.clientX,e.clientY):me(e.clientX,e.clientY),r=Math.hypot(e.clientX-t.x,e.clientY-t.y);Z(),n&&(t.region?n.box.width>=6&&n.box.height>=6:r<6)&&ve(n)}function be(){if(!T||!D.trim()||U&&!O||N.length>=50)return;let t={target:e,fileName:G,page:T.page,text:T.text.slice(0,g),requirement:D.trim(),region:T.region,imageName:O?.name,...H?{unmapped:!0}:{}};P(e=>[...e,{annotation:t,file:O}]),X()}function xe(){if(!de)try{let e=se({items:N,inputActions:a,intake:i,limits:V,existingImages:i?.images(B.attachmentIds)??[],deferSubmit:!!B.draft.trim()||B.attachmentIds.length>0});P([]),I(!1),x(!1),X(),z(e===`draft`?c(`annotation.draftReady`):``)}catch(e){let t=e instanceof Error?e.message:`annotation.sendFailed`;z(c(t.startsWith(`annotation.`)?t:`annotation.sendFailed`))}}let Q=T??S,Se=Q&&!T&&!j&&Q.canvas?ee(Q.box,Q.canvas.getBoundingClientRect()):Q?.box,$=Se&&p?b(Se,p):void 0,Ce=p?Math.min(360,p.width-16):0,we=p&&T?Math.max(p.left+8,Math.min(T.box.left,p.left+p.width-Ce-8)):0,Te=p&&T?Math.max(p.top+4,Math.min(T.box.top+T.box.height+6,p.top+p.height-56)):0;return(0,n.jsxs)(`span`,{ref:l,className:`dsh-office-annotate`,onKeyDown:e=>{if(!y||e.key!==`Escape`)return;e.preventDefault(),e.stopPropagation();let t=!!T||!!J.current;X(),Z(),t?d.current?.focus():(x(!1),l.current?.querySelector(`button`)?.focus())},children:[(0,n.jsx)(`button`,{type:`button`,className:`dsh-office-annotate-toggle`,"aria-pressed":y,disabled:!p||U&&!i,title:c(U&&!i?`annotation.intakeUnavailable`:p?`annotation.help`:`annotation.unavailable`),onClick:()=>{x(e=>!e),X(),Z()},children:c(`annotation.ask`)}),U&&!i&&(0,n.jsx)(`span`,{role:`status`,className:`dsh-office-annotate-unavailable`,children:c(`annotation.intakeUnavailable`)}),y&&p&&(0,n.jsx)(`div`,{ref:d,className:`dsh-office-annotate-surface`,tabIndex:0,style:{left:p.left,top:p.top,width:p.width,height:p.height},role:`region`,"aria-label":c(`annotation.help`),onPointerDown:ge,onPointerMove:_e,onPointerUp:ye,onPointerCancel:Z,onLostPointerCapture:Z,onKeyDown:e=>{if(e.key===`PageDown`||e.key===`PageUp`)e.preventDefault(),fe(0,p.height*(e.key===`PageDown`?.8:-.8));else if(e.key===`ArrowDown`||e.key===`ArrowUp`){e.preventDefault();let t=[...f.current.querySelectorAll(`canvas[role="img"][aria-label]`)].flatMap((e,t)=>ne(e).filter(e=>b(e.box,p)).map(n=>({...n,canvas:e,page:t+1}))),n=t.findIndex(e=>e.canvas===S?.canvas&&e.text===S.text&&e.box.top===S.box.top),r=n<0?e.key===`ArrowDown`?0:t.length-1:Math.max(0,Math.min(t.length-1,n+(e.key===`ArrowDown`?1:-1)));C(t[r])}else(e.key===`Enter`||e.key===` `)&&S&&(e.preventDefault(),ve(S))},onPointerLeave:()=>{J.current||C(void 0)}}),y&&$&&(0,n.jsx)(`span`,{className:`dsh-office-annotate-highlight`,"data-selected":T||j?`true`:void 0,style:{left:$.left,top:$.top,width:$.width,height:$.height}}),y&&T&&p&&(0,n.jsxs)(`form`,{ref:u,className:`dsh-office-annotate-composer`,style:{left:we,top:Te,width:Ce},"aria-label":c(`annotation.ask`),"aria-busy":k,onSubmit:e=>{e.preventDefault(),be()},children:[(0,n.jsx)(`input`,{type:`text`,"aria-label":c(`annotation.placeholder`),placeholder:c(`annotation.placeholder`),value:D,maxLength:2e4,onChange:e=>ce(e.target.value),onKeyDown:e=>{e.key===`Enter`&&e.nativeEvent.isComposing&&e.preventDefault()}}),(0,n.jsx)(`button`,{type:`submit`,"aria-label":c(k?`annotation.capturing`:`annotation.add`),title:c(k?`annotation.capturing`:`annotation.add`),disabled:!D.trim()||k||U&&!O||N.length>=50,children:(0,n.jsx)(`svg`,{width:`18`,height:`18`,viewBox:`0 0 24 24`,fill:`none`,"aria-hidden":`true`,children:(0,n.jsx)(`path`,{d:`m5 12 4 4L19 6`,stroke:`currentColor`,strokeWidth:`2`,strokeLinecap:`round`,strokeLinejoin:`round`})})})]}),(y||N.length>0||R)&&p&&(0,n.jsx)(`div`,{className:`dsh-office-annotate-rail-position`,style:{left:p.left,width:p.width,bottom:Math.max(0,window.innerHeight-p.top-p.height)+12,"--dsh-office-annotation-width":`${p.width}px`,"--dsh-office-annotation-height":`${p.height}px`},children:(0,n.jsxs)(`div`,{className:`dsh-office-annotate-rail`,children:[R&&(0,n.jsx)(`p`,{role:`alert`,children:R}),(0,n.jsxs)(`div`,{className:`dsh-office-annotate-rail-actions`,children:[(0,n.jsxs)(`div`,{className:`dsh-office-annotate-summary`,"data-dismissed":F?`true`:void 0,onPointerEnter:()=>I(!1),onFocus:()=>I(!1),onKeyDown:e=>{e.key===`Escape`&&(e.stopPropagation(),e.currentTarget.querySelector(`button`)?.focus(),I(!0))},children:[(0,n.jsx)(`button`,{type:`button`,"aria-haspopup":`dialog`,"aria-controls":L,disabled:!N.length,children:_(c(`annotation.count`),{count:String(N.length)})}),N.length>0&&(0,n.jsx)(`div`,{id:L,role:`dialog`,"aria-label":_(c(`annotation.count`),{count:String(N.length)}),className:`dsh-office-annotate-popover`,children:(0,n.jsx)(`ul`,{children:N.map((e,t)=>(0,n.jsx)(`li`,{children:(0,n.jsxs)(`div`,{children:[(0,n.jsxs)(`span`,{className:`dsh-office-annotation-source`,children:[(0,n.jsx)(`span`,{title:e.annotation.target,children:e.annotation.fileName}),e.annotation.page&&(0,n.jsx)(`span`,{children:_(c(`annotation.page`),{page:String(e.annotation.page)})})]}),e.annotation.text&&(0,n.jsx)(`span`,{className:`dsh-office-annotation-original`,children:e.annotation.text}),(0,n.jsx)(`span`,{className:`dsh-office-annotation-requirement`,title:e.annotation.requirement,children:e.annotation.requirement})]})},e.annotation.imageName??t))})})]}),(0,n.jsx)(`button`,{type:`button`,onClick:()=>{P([]),x(!1),I(!1),z(``),X(),Z()},children:c(`annotation.cancel`)}),(0,n.jsx)(`button`,{type:`button`,className:`dsh-office-annotate-primary`,disabled:!N.length||de,onClick:xe,children:c(`annotation.send`)})]})]})})]})}function k(e){let{size:t=16,...n}=e;return{width:t,height:t,viewBox:`0 0 16 16`,fill:`none`,"aria-hidden":!0,...n}}function A(e){return(0,n.jsx)(`svg`,{...k(e),children:(0,n.jsx)(`path`,{fill:`currentColor`,fillRule:`evenodd`,clipRule:`evenodd`,d:`M5 13.5h6a1.5 1.5 0 0 0 1.5-1.5V7.243a1.5 1.5 0 0 0-.44-1.061L8.819 2.939a1.5 1.5 0 0 0-1.06-.439H5A1.5 1.5 0 0 0 3.5 4v8A1.5 1.5 0 0 0 5 13.5m9-6.257a3 3 0 0 0-.879-2.122L9.88 1.88A3 3 0 0 0 7.757 1H5a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3zM5 8.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 8.25m.75 2.25a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5z`})})}function j(e){return(0,n.jsx)(`svg`,{...k(e),children:(0,n.jsx)(`path`,{fill:`currentColor`,fillRule:`evenodd`,clipRule:`evenodd`,d:`M11 13.5H5A1.5 1.5 0 0 1 3.5 12V4A1.5 1.5 0 0 1 5 2.5h2.757a1.5 1.5 0 0 1 1.061.44l3.243 3.242a1.5 1.5 0 0 1 .439 1.06V12a1.5 1.5 0 0 1-1.5 1.5m2.121-8.379A3 3 0 0 1 14 7.243V12a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3h2.757a3 3 0 0 1 2.122.879zM6.5 6.5a.75.75 0 0 0-.75.75v4a.75.75 0 0 0 1.5 0v-.75H8.5a2 2 0 1 0 0-4zm2 2.5H7.25V8H8.5a.5.5 0 0 1 0 1`})})}function M(e){return(0,n.jsx)(`svg`,{...k(e),children:(0,n.jsx)(`path`,{fill:`currentColor`,fillRule:`evenodd`,clipRule:`evenodd`,d:`M12 3H4a1.5 1.5 0 0 0-1.5 1.5v4A1.5 1.5 0 0 0 4 10h8a1.5 1.5 0 0 0 1.5-1.5v-4A1.5 1.5 0 0 0 12 3M4 1.5a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h3.25V13h-2.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-2.5v-1.5H12a3 3 0 0 0 3-3v-4a3 3 0 0 0-3-3z`})})}function N(e){return(0,n.jsx)(`svg`,{...k(e),children:(0,n.jsx)(`path`,{fill:`currentColor`,fillRule:`evenodd`,clipRule:`evenodd`,d:`M9.25 3.5h-2.5v2h2.5zM4 3.5h1.25v2H2.5V5A1.5 1.5 0 0 1 4 3.5M2.5 7h2.75v2H2.5zm0 3.5v.5A1.5 1.5 0 0 0 4 12.5h1.25v-2zm4.25 0v2h2.5v-2zm4 0v2H12a1.5 1.5 0 0 0 1.5-1.5v-.5zM13.5 9h-2.75V7h2.75zM9.25 9h-2.5V7h2.5zm1.5-5.5v2h2.75V5A1.5 1.5 0 0 0 12 3.5zM4 2a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3z`})})}const P={documents:A,pdf:j,presentations:M,spreadsheets:N};function F(e){return`Use the "${e.skill}" skill for this request and follow its instructions before creating, editing, or rendering files.`}function I(e){return`/${e.command}\n\n${F(e)}`}const L={id:c,order:20,match(e,t){let n=/(?<!\S)\/([\w-]+)(?!\S)/gu;n.lastIndex=t;for(let t=n.exec(e);t!==null;t=n.exec(e)){let n=a(t[1]??``);if(n===void 0)continue;let r=t.index,i=r+t[0].length,o=e.slice(i),s=o.length-o.trimStart().length,l=F(n);return{id:c,start:r,end:o.startsWith(l,s)?i+s+l.length:i,data:{feature:n.id}}}}};function R({node:e,raw:t,interactive:r,openOffice:a,officeLabel:o}){let s=i(e.data.feature);if(s==null)return(0,n.jsx)(`span`,{children:t});let c=P[s.id],l=`/${s.command}`,u=(0,n.jsxs)(n.Fragment,{children:[(0,n.jsx)(c,{className:`dsh-office-ref-icon`,size:14}),(0,n.jsx)(`span`,{children:o(s.id)})]});return r?(0,n.jsx)(`button`,{type:`button`,className:`dsh-office-ref`,title:l,"data-interactive":!0,onClick:()=>a(s.id),children:u}):(0,n.jsx)(`span`,{className:`dsh-office-ref`,title:l,children:u})}function z(){if(typeof document>`u`)return()=>{};let e=document.querySelector(`style[data-plugin-css="dsh-office-kit/reference.css"]`)??document.createElement(`style`);return e.dataset.plugin=o,e.dataset.pluginCss=`dsh-office-kit/reference.css`,e.textContent=`
.dsh-office-ref {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  height: calc(20px + var(--dsh-content-font-delta, 0px));
  padding: 0 6px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  line-height: 1;
  vertical-align: baseline;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-office-ref[data-interactive] { cursor: pointer; }
.dsh-office-ref[data-interactive]:hover {
  background: var(--dsw-alias-interactive-bg-hover-solid);
  color: var(--dsw-alias-label-primary);
}
.dsh-office-ref[data-interactive]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dsh-office-ref-icon { flex: none; color: var(--dsw-alias-label-tertiary); }
.dsh-office-ref[data-interactive]:hover .dsh-office-ref-icon { color: inherit; }
.dsh-office-annotate { display: inline-flex; flex: none; }
.dsh-office-annotate,
.dsh-office-annotation-reference { font: 400 12px/18px var(--dsw-font-family, system-ui, sans-serif); }
.dsh-office-annotate *,
.dsh-office-annotation-reference * { box-sizing: border-box; }
.dsh-office-annotate button,
.dsh-office-annotation-reference button {
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  padding: 5px 9px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  font: inherit;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
}
.dsh-office-annotate button:disabled { opacity: .45; cursor: not-allowed; }
.dsh-office-annotate button:hover:not(:disabled),
.dsh-office-annotation-reference button:hover { background: var(--dsw-alias-interactive-bg-hover-solid); }
.dsh-office-annotate button:focus-visible,
.dsh-office-annotation-reference button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.dsh-office-annotate .dsh-office-annotate-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  padding: 0 8px;
  line-height: 1;
}
.dsh-office-annotate .dsh-office-annotate-toggle[aria-pressed="true"],
.dsh-office-annotate .dsh-office-annotate-primary {
  color: var(--dsw-alias-state-business-primary);
  border-color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, var(--dsw-alias-bg-base));
}
.dsh-office-annotate .dsh-office-annotate-surface {
  position: fixed;
  z-index: 40;
  touch-action: none;
  user-select: none;
  outline: none;
  cursor: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2220%22%20height%3D%2220%22%20fill%3D%22none%22%20viewBox%3D%220%200%2016%2016%22%3E%3Cpath%20fill%3D%22%23466eff%22%20fill-rule%3D%22evenodd%22%20d%3D%22M8%2013c3.866%200%207-2%207-6s-3.134-6-7-6-7%202-7%206c0%202.16.914%203.737%202.364%204.73l.09%202.161a1.157%201.157%200%200%200%201.857.872l2.322-1.77Q7.816%2013%208%2013%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E") 4 18, crosshair;
}
.dsh-office-annotate .dsh-office-annotate-highlight {
  position: fixed;
  z-index: 41;
  box-sizing: border-box;
  pointer-events: none;
  border: 1.25px solid var(--dsw-alias-state-business-primary);
  border-radius: 3px;
}
.dsh-office-annotate .dsh-office-annotate-highlight[data-selected="true"] {
  border-style: dashed;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent);
}
.dsh-office-annotate .dsh-office-annotate-composer {
  position: fixed;
  z-index: 42;
  box-sizing: border-box;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-shadow-lv2);
}
.dsh-office-annotate .dsh-office-annotate-composer {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
}
.dsh-office-annotate .dsh-office-annotate-composer input:focus-visible { outline: none; }
.dsh-office-annotate .dsh-office-annotate-composer input {
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  border-radius: 999px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
}
.dsh-office-annotate .dsh-office-annotate-composer button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, var(--dsw-alias-bg-base));
}
.dsh-office-annotate .dsh-office-annotate-composer button svg { width: 14px; height: 14px; }
.dsh-office-annotate .dsh-office-annotate-rail-position {
  position: fixed;
  z-index: 42;
  display: flex;
  justify-content: center;
  padding: 0 8px;
  pointer-events: none;
}
.dsh-office-annotate .dsh-office-annotate-rail {
  position: relative;
  width: max-content;
  max-width: 100%;
  padding: 4px 6px;
  border-radius: 10px;
  background: var(--dsw-alias-toast-bg);
  color: var(--dsw-alias-toast-label);
  font: 500 12px/18px var(--dsw-font-family, system-ui, sans-serif);
  box-shadow: var(--dsw-shadow-lv3);
  pointer-events: auto;
}
.dsh-office-annotate .dsh-office-annotate-rail-actions { display: flex; align-items: center; justify-content: center; gap: 4px; }
.dsh-office-annotate .dsh-office-annotate-rail-actions > button,
.dsh-office-annotate .dsh-office-annotate-summary > button {
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  white-space: nowrap;
}
.dsh-office-annotate .dsh-office-annotate-summary { padding-right: 4px; border-right: 1px solid color-mix(in srgb, var(--dsw-alias-toast-label) 25%, transparent); }
.dsh-office-annotate .dsh-office-annotate-rail-actions > button:hover:not(:disabled),
.dsh-office-annotate .dsh-office-annotate-summary > button:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-toast-label) 12%, transparent); }
.dsh-office-annotate .dsh-office-annotate-rail-actions > .dsh-office-annotate-primary { background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-toast-label); }
.dsh-office-annotate .dsh-office-annotate-rail-actions > .dsh-office-annotate-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 85%, var(--dsw-alias-toast-label)); }
.dsh-office-annotate .dsh-office-annotate-rail p { max-width: min(360px, calc(var(--dsh-office-annotation-width) - 48px)); margin: 0 0 6px; font-size: 12px; overflow-wrap: anywhere; }
.dsh-office-annotate .dsh-office-annotate-popover {
  display: none;
  position: absolute;
  bottom: 100%;
  left: 50%;
  width: min(320px, calc(var(--dsh-office-annotation-width, 100vw) - 16px), calc(100vw - 16px));
  box-sizing: border-box;
  padding-bottom: 8px;
  transform: translateX(-50%);
}
.dsh-office-annotate .dsh-office-annotate-summary:not([data-dismissed="true"]):is(:hover, :focus-within) > .dsh-office-annotate-popover { display: block; }
.dsh-office-annotation-reference { display: inline-block; position: relative; max-width: 100%; vertical-align: baseline; font: inherit; }
.dsh-office-annotation-reference > button {
  max-width: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--dsw-alias-link);
  font: inherit;
  font-family: var(--dsw-font-markdown-code-font-family);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: baseline;
}
.dsh-office-annotation-reference > button:hover {
  background: transparent;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}
.dsh-office-annotation-reference .dsh-office-annotation-popover {
  display: none;
  position: fixed;
  z-index: 44;
  inset: auto;
  width: min(320px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  box-sizing: border-box;
  margin: 0;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  overflow: visible;
  text-align: left;
  font: 400 12px/18px var(--dsw-font-family, system-ui, sans-serif);
}
.dsh-office-annotation-reference .dsh-office-annotation-popover[data-open="true"] { display: block; }
.dsh-office-annotation-reference .dsh-office-annotation-popover::backdrop { pointer-events: none; }
.dsh-office-annotate .dsh-office-annotate-popover > ul,
.dsh-office-annotation-reference .dsh-office-annotation-list {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  max-height: min(340px, 45vh);
  margin: 0;
  padding: 0 8px;
  font: 400 12px/18px var(--dsw-font-family, system-ui, sans-serif);
  text-align: left;
  overflow: auto;
  list-style: none;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-shadow-lv2);
}
.dsh-office-annotate .dsh-office-annotate-popover > ul { max-height: min(340px, 45vh, max(40px, calc(var(--dsh-office-annotation-height, 100vh) - 80px))); }
.dsh-office-annotate .dsh-office-annotate-popover li,
.dsh-office-annotation-reference .dsh-office-annotation-item { display: flex; flex: none; flex-direction: column; gap: 3px; min-width: 0; padding: 8px 0; }
.dsh-office-annotate .dsh-office-annotate-popover li > div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dsh-office-annotate .dsh-office-annotate-popover .dsh-office-annotation-requirement { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-office-annotate .dsh-office-annotate-popover li + li,
.dsh-office-annotation-reference .dsh-office-annotation-item + .dsh-office-annotation-item { border-top: .5px solid var(--dsw-alias-border-l3); }
.dsh-office-annotate .dsh-office-annotation-source,
.dsh-office-annotation-reference .dsh-office-annotation-source { display: flex; align-items: baseline; gap: 8px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-office-annotation-reference .dsh-office-annotation-source button { padding: 0; border: 0; color: var(--dsw-alias-state-business-primary); text-align: left; }
.dsh-office-annotate .dsh-office-annotation-source > :first-child,
.dsh-office-annotation-reference .dsh-office-annotation-source > :first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-office-annotate .dsh-office-annotation-source > :not(:first-child),
.dsh-office-annotation-reference .dsh-office-annotation-source > :not(:first-child) { flex: none; }
.dsh-office-annotate .dsh-office-annotation-original,
.dsh-office-annotation-reference .dsh-office-annotation-original { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-office-annotate .dsh-office-annotation-requirement,
.dsh-office-annotation-reference .dsh-office-annotation-requirement { display: block; white-space: pre-wrap; overflow-wrap: anywhere; }
`,document.head.appendChild(e),()=>e.remove()}const B=[`inputTriggers`,`sessions`,`slots`,`locale`,`remote`,`remote.skills`,`sidebarRight`,`uiConversation`,`conversation`],V={"menu.group":`办公`,"menu.documents.label":`文档`,"menu.documents.description":`创建、读取、编辑和渲染 DOCX 文档`,"menu.pdf.label":`PDF 文档`,"menu.pdf.description":`读取、创建、检查、渲染和验证 PDF`,"menu.presentations.label":`演示文稿`,"menu.presentations.description":`创建、编辑、渲染和导出 PPTX 演示文稿`,"menu.spreadsheets.label":`电子表格`,"menu.spreadsheets.description":`创建、编辑、计算和导出 XLSX 电子表格`,"annotation.ask":`请求修改`,"annotation.cancel":`取消`,"annotation.send":`发送`,"annotation.add":`添加标注`,"annotation.placeholder":`说明要怎么改…`,"annotation.page":`第 {page} 页`,"annotation.count":`{count} 条注释`,"annotation.remove":`删除第 {index} 条注释`,"annotation.image":`位置截图：{name}`,"annotation.help":`悬停吸附段落，点击输入要求；长按拖动框选区域，松开添加标注。方向键选择，Enter 确认，Esc 退出。`,"annotation.unavailable":`等待文档页面渲染；当前预览不支持标注`,"annotation.capturing":`正在截图…`,"annotation.captureFailed":`截图失败，请重新选择区域`,"annotation.intakeUnavailable":`当前 DSH 版本不支持从侧栏添加截图附件，PDF 与表格标注已禁用`,"annotation.imageLimit":`截图超过当前模型的数量或大小限制，请减少标注后重试`,"annotation.sendFailed":`未能加入会话，请重试；标注仍保留`,"annotation.draftReady":`标注和截图已保留在会话输入框，请在那里确认发送`,"annotation.invalid":`标注内容无效，请重新添加`,"annotation.tooLarge":`标注内容过长，请减少后重试`,"annotation.emptyPage":`页面尚未渲染，请重试`,"annotation.emptyRegion":`请选择页面内的区域`},ue={"menu.group":`Office`,"menu.documents.label":`Documents`,"menu.documents.description":`Create, read, edit, and render DOCX documents`,"menu.pdf.label":`PDF documents`,"menu.pdf.description":`Read, create, inspect, render, and verify PDFs`,"menu.presentations.label":`Presentations`,"menu.presentations.description":`Create, edit, render, and export PPTX decks`,"menu.spreadsheets.label":`Spreadsheets`,"menu.spreadsheets.description":`Create, edit, calculate, and export XLSX workbooks`,"annotation.ask":`Request changes`,"annotation.cancel":`Cancel`,"annotation.send":`Send`,"annotation.add":`Add annotation`,"annotation.placeholder":`Describe the change…`,"annotation.page":`page {page}`,"annotation.count":`{count} annotations`,"annotation.remove":`Remove annotation {index}`,"annotation.image":`Location screenshot: {name}`,"annotation.help":`Hover to select a paragraph; click to comment. Hold and drag to select a region. Arrow keys select, Enter confirms, Esc exits.`,"annotation.unavailable":`Waiting for rendered pages; this preview cannot be annotated yet`,"annotation.capturing":`Capturing…`,"annotation.captureFailed":`Screenshot failed; please select the region again`,"annotation.intakeUnavailable":`This DSH version cannot add screenshots from the sidebar; PDF and spreadsheet annotation is disabled`,"annotation.imageLimit":`Screenshots exceed the current model’s count or size limits; remove some annotations and retry`,"annotation.sendFailed":`Could not add annotations to the conversation; your annotations are retained`,"annotation.draftReady":`Annotations and screenshots are kept in the conversation input; confirm sending there`,"annotation.invalid":`Invalid annotation; please add it again`,"annotation.tooLarge":`Annotations are too long; remove some and retry`,"annotation.emptyPage":`The page has not rendered yet; please retry`,"annotation.emptyRegion":`Select a region inside the page`};function H(e){return encodeURIComponent(e).replace(/%3A/gi,`:`)}function U(e){return e.split(`/`).map(H).join(`/`)}function W(e,t){let n=t.replace(/\\/g,`/`).replace(/^(?:\.\/)+/u,``);return`dsh-resource://file/session/${H(e)}/${U(n)}`}function G(e,t,n){let r=n.replace(/\\/g,`/`),i=t?.replace(/\\/g,`/`).replace(/\/+$/u,``)??``;return/^(?:\/|[A-Za-z]:\/|\\\\)/u.test(r)&&i!==``&&r.startsWith(`${i}/`)?W(e,r.slice(i.length+1)):W(e,r)}function K(t){let n=t.sessions,f=t.remote.skills,p=t.locale.bind(o),m=new Map,h=new Map;t.effect(()=>z(),`office-suite: styles`),t.effect(()=>t.locale.register(o,{zh:V,en:ue}),`office-suite: dictionaries`);function g(e){let t=m.get(e);if(t!==void 0)return t;let r=new AbortController,i=(async()=>{if(n.binding(e)===void 0)throw Error(`office catalog requires a retained session "${e}"`);return n.using(e,{source:`officeCatalog`,signal:r.signal},async t=>{r.signal.throwIfAborted();let n=t.binding.session.getSnapshot();if(n.openState!==`open`)throw n.openError??Error(`session "${e}" is not open`);let i=await f.list({sessionId:e},r.signal);if(r.signal.throwIfAborted(),!i.ok)throw Error(`skills/list failed: ${i.error.code}: ${i.error.message}`);return i.value.skills})})(),a={abort:r,promise:i};return m.set(e,a),i.then(e=>{a.settled=e},()=>{m.get(e)===a&&m.delete(e)}),a}function _(e,r,a){let o=i(r);if(o===void 0)return!1;let s=a.find(e=>e.name===o.skill);if(s?.path===void 0)return!1;let c=n.list.getSnapshot().byId[e]?.cwd;try{return t.sidebarRight.openResource(G(e,c,s.path)),!0}catch(e){return console.error(`[dsh-office-kit] reference preview failed:`,e),!1}}let v={trigger:`/`,name:s,order:1,async candidates(t,{query:n,signal:i}){if(i.aborted)return[];let a=r.map(e=>{let t=P[e.id];return{name:e.command,label:p(`menu.${e.id}.label`),description:p(`menu.${e.id}.description`),section:p(`menu.group`),icon:t}});return n.length===0?a:(0,e.rankByName)(a,n)},lexicon(){return r.map(e=>e.command)},openReference(e,{ref:t}){let n=i(t);if(n===void 0)return!1;let r=m.get(e.sessionId)?.settled;if(r!==void 0)return _(e.sessionId,n.id,r);let a=g(e.sessionId);return a.promise.then(t=>{a.abort.signal.aborted||_(e.sessionId,n.id,t)}).catch(e=>{a.abort.signal.aborted||console.error(`[dsh-office-kit] reference preview failed:`,e)}),!0},onPick({candidate:e}){let t=a(e.name);if(t!==void 0)return{insert:{source:s,ref:t.id,label:p(`menu.${t.id}.label`),appearance:`file`,clipboardText:`/${t.command}`}}},codec:{clipboardText(e){let t=i(e);return t===void 0?`/${e}`:`/${t.command}`},async serialize(e){let t=i(e);return t===void 0?`/documents`:I(t)}}};t.effect(()=>t.uiConversation.userText.register(L),`office-suite: transcript chip`),t.effect(()=>t.slots.inject(l,()=>t.slots.register({name:l,key:c,priority:100,inject:e=>({openOffice:t=>{v.openReference?.({sessionId:e},{ref:t,appearance:`file`})},officeLabel:e=>p(`menu.${e}.label`)})},R)),`office-suite: transcript chip slot`);function y(e){let r=t.conversation,i=typeof r.createDrafts==`function`&&typeof r.releaseDraftAttachments==`function`&&typeof r.resolveDraftAttachments==`function`,a=h.get(e);return a||(a=new Map,h.set(e,a)),{pendingAnnotations:a,intake:i?{create:t=>r.createDrafts(e,t),release:e=>r.releaseDraftAttachments(e),images:e=>r.resolveDraftAttachments(e).filter(e=>e.kind===`image`).map(e=>e.file)}:void 0,openAnnotation:r=>{try{let i=n.list.getSnapshot().byId[e]?.cwd;t.sidebarRight.openResource(G(e,i,r))}catch(e){console.error(`[dsh-office-kit] annotation preview failed:`,e)}}}}t.effect(()=>t.uiConversation.userText.register(D),`office-suite: annotations`),t.effect(()=>t.slots.inject(l,()=>t.slots.register({name:l,key:d,priority:100,locale:o,inject:y},ce)),`office-suite: annotation references`),t.effect(()=>t.slots.inject(u,()=>t.slots.register({name:u,id:`office-annotations`,order:20,locale:o,inject:y},O)),`office-suite: annotation tool`);let b=t.inputTriggers;t.effect(()=>{let e=b.registerSource(v);return()=>{e();for(let e of m.values())e.abort.abort();m.clear(),h.clear()}},`office-suite: slash source`)}exports.apply=K,exports.inject=B;
return module.exports;}});
//# sourceMappingURL=client.js.map