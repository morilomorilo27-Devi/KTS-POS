(function(root){
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const path=kind=>({notebook:'M5 3h14v18H5z M8 3v18 M11 8h5 M11 12h5',pen:'m5 16-2 5 5-2L20 7l-4-4L5 16z M13 6l5 5',art:'M12 3C5 3 2 7 2 12s4 9 9 9c3 0 1-4 4-4h3c6 0 4-14-6-14z',bag:'M6 7h12l3 14H3L6 7z M8 7V5a4 4 0 0 1 8 0v2',folder:'M3 6h7l3 3h8v12H3z',box:'m3 7 9-4 9 4v12l-9 3-9-3V7z M3 7l9 4 9-4 M12 11v11'}[kind]||'M3 5h18v16H3z M7 5V3 M17 5V3');
 function miniature(product,options={}) {
  const kind=product?.kind||'notebook';const image=product?.image;
  if(image&&/^\/images\/[\w./-]+$/.test(image)&&!image.includes('..'))return `<div class="product-object photo-object" data-kind="${escape(kind)}"><img src="${escape(image)}" alt="" loading="${options.eager?'eager':'lazy'}" decoding="async"><div class="photo-fallback" hidden>${miniature({...product,image:''},options)}</div></div>`;
  const icon=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path(kind)}"/></svg>`;
  if(kind==='pen')return '<div class="product-object pen-object"><i class="pen-barrel"></i><i class="pen-cap"></i><i class="pen-clip"></i><i class="pen-tip"></i></div>';
  if(kind==='ruler')return '<div class="product-object ruler-object"><i></i></div>';
  if(kind==='bag')return '<div class="product-object bag-object"><i class="bag-handle"></i><i class="bag-pocket"></i><i class="bag-zip"></i></div>';
  if(kind==='colours'||kind==='art')return `<div class="product-object colours-object"><div class="pencil-set">${[0,1,2,3,4,5].map(n=>`<i style="--pencil:${n}"></i>`).join('')}</div><div class="colours-sleeve">${icon}</div></div>`;
  return `<div class="product-object ${kind==='folder'?'folder-object':kind==='large'?'box-object':kind==='box'?'box-object':'notebook-object'}"><div class="object-pages"></div><div class="object-spine"></div><div class="object-cover"><span class="object-mark">${icon}</span><i class="object-line"></i><i class="object-line short"></i></div><div class="object-elastic"></div></div>`;
 }
 function imageFallback(container){for(const img of container.querySelectorAll('.photo-object img')){img.onerror=()=>{img.hidden=true;const fallback=img.nextElementSibling;if(fallback)fallback.hidden=false;};if(img.complete&&!img.naturalWidth)img.onerror();}}
 root.CustomerObjects={miniature,escape,imageFallback};
})(window);
