/* Independent customer display: state reducer, incremental view, restrained motion and push transports. */
(function(){
 const L=CustomerLocale,O=CustomerObjects,$=id=>document.getElementById(id),escape=O.escape;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 for(const element of document.querySelectorAll('[data-text]'))element.textContent=L[element.dataset.text]||'';
 $('displayFullscreen').setAttribute('aria-label',L.fullscreen);
 $('displayFullscreen').onclick=()=>{const task=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();task?.catch(()=>{});};
 for(const [selector,kind] of [['.idle-notebook','notebook'],['.idle-pen','pen'],['.idle-ruler','ruler'],['.idle-colours','colours']])document.querySelector(selector).innerHTML=O.miniature({kind});
 function money(value){return Number(value||0).toFixed(3)+' '+L.currency;}
 function animateMoney(el,value){
  value=Number(value)||0;if(el._target===value)return;el._target=value;
  if(!el._number){el.classList.add('money-value');el._number=document.createElement('span');el._number.dir='ltr';const currency=document.createElement('small');currency.textContent=L.currency;el.replaceChildren(el._number,currency);}
  cancelAnimationFrame(el._frame);const from=el._value||0;const started=performance.now();
  const step=now=>{const t=reduced?1:Math.min(1,(now-started)/280);el._value=from+(value-from)*(1-Math.pow(1-t,3));el._number.textContent=el._value.toFixed(3);if(t<1)el._frame=requestAnimationFrame(step);};el._frame=requestAnimationFrame(step);
 }
 const display={
  state:CustomerDisplayState.initial(),config:{campaign:'everyday',theme:'sage',featured:[],offers:[],show_suggestions:true,show_membership:true},rows:new Map(),basketNodes:new Map(),epochs:new Set(),lastMicrocopy:0,lastSuggestion:0,lastLocal:0,
  configure(config){if(!config)return;this.config={...this.config,...config};document.body.dataset.theme=this.config.theme;const logo=this.config.logo;if(logo&&/^\/images\/[\w./-]+$/.test(logo)&&!logo.includes('..'))$('displayLogo').src=logo;sessionStorage.setItem('kts-display-config:'+channel,JSON.stringify(this.config));this.rotateWelcome();},
  campaign(){const c=this.config;const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuwait',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());this.campaignActive=!((c.starts_at&&day<c.starts_at)||(c.ends_at&&day>c.ends_at));if(!this.campaignActive)return 'everyday';return c.campaign==='auto'?([8,9].includes(Number(day.slice(5,7)))?'school':'everyday'):c.campaign;},
  rotateWelcome(){
   const campaign=this.campaign();document.body.dataset.campaign=campaign;$('campaignCaption').textContent=L.campaign[campaign]||L.campaign.everyday;
   if(!['idle','welcome'].includes(this.state.mode))return;
   const messages=this.campaignActive&&this.config.welcome_messages?.length?this.config.welcome_messages:campaign==='school'?L.school:L.welcome;
   this.welcomeIndex=((this.welcomeIndex??-1)+1)%messages.length;$('experienceTitle').textContent=messages[this.welcomeIndex];$('experienceDetail').textContent=L.welcomeDetail;
   const featured=this.config.featured||[];const item=featured[this.welcomeIndex%Math.max(1,featured.length)];
   $('featuredSpotlight').hidden=!item;
   if(item){$('featuredSpotlight').innerHTML=`${item.image?`<img src="${escape(item.image)}" alt="" loading="lazy">`:''}<strong>${escape(item.name)}</strong><span>${escape(money(item.price))}</span>`;}
   const offer=this.campaignActive&&this.config.offers?.[this.welcomeIndex%Math.max(1,this.config.offers?.length||0)];$('contextMicrocopy').textContent=offer||L.newIdeas;$('piecesLabel').textContent='';
   if($('campaignArt'))$('campaignArt').hidden=!this.campaignActive;
   if(this.config.asset_url&&/^\/images\/[\w./-]+$/.test(this.config.asset_url)&&!this.config.asset_url.includes('..')){let art=$('campaignArt');if(!art){art=document.createElement('img');art.id='campaignArt';art.alt='';$('productStage').prepend(art);}art.src=this.config.asset_url;art.hidden=!this.campaignActive;}
  },
  accept(event,source='sse'){
   if(event.config)this.configure(event.config);
   if(event.type==='CONFIG'){this.render();return;}
   if(source==='local'){this.lastLocal=Date.now();this.armLocalTimeout();}
   if(event.type==='PRESENCE'){this.presence(true,source);return;}
   if(event.epoch){
    if(this.epochs.has(event.epoch)&&this.state.epoch&&event.epoch!==this.state.epoch)return;
    if(event.epoch===this.state.epoch&&event.sequence<this.state.sequence)return;
    if(event.epoch===this.state.epoch&&event.sequence===this.state.sequence&&event.type!=='CONNECTED'){
      if(event.state?.receipt){this.state.order={...this.state.order,receipt:event.state.receipt};this.receipt(event.state.receipt);}return;
    }
    if(this.state.epoch&&this.state.epoch!==event.epoch)this.epochs.add(this.state.epoch);
   }
   if(event.type==='CONNECTED'&&event.online===false&&Date.now()-this.lastLocal<35000)return;
   const before=this.state.order;this.state=CustomerDisplayState.reduce(this.state,event);this.presence(this.state.mode!=='offline',source);
   this.render(before,event.type);
   if(event.type==='DISCOUNT_APPLIED'&&this.state.order?.discount>0){clearTimeout(this.rewardTimer);this.rewardTimer=setTimeout(()=>this.accept({type:'REWARD_FINISHED'}),3600);}
   if(event.type==='PAYMENT_SUCCESS'||event.type==='ORDER_COMPLETED'||(event.type==='CONNECTED'&&this.state.mode==='success')){clearTimeout(this.successTimer);this.successTimer=setTimeout(()=>{if(this.state.mode==='success')this.accept({type:'RESET'});},8500);}
  },
  presence(online,source){$('displayPresence').querySelector('span').textContent=online?(source==='local'?L.local:L.online):L.offline;$('displayPresence').dataset.online=String(online);},
  armLocalTimeout(){clearTimeout(this.localTimeout);this.localTimeout=setTimeout(()=>{if(!this.sseConnected)this.accept({type:'DISCONNECTED'});},36000);},
  render(before,event){
   const {mode,order}=this.state;document.body.dataset.mode=mode;
   $('pairingPanel').hidden=true;$('offlinePanel').hidden=mode!=='offline';$('rewardMoment').hidden=mode!=='discount';$('completionPanel').hidden=!['payment','success'].includes(mode);
   $('trainingNotice').hidden=!order?.training;
   if(['idle','welcome'].includes(mode)){this.rotateWelcome();if(this.state.notice)$('contextMicrocopy').textContent=L[this.state.notice];this.renderRows([]);this.renderBasket([]);$('memberMoment').hidden=true;return;}
   if(mode==='offline')return;
   if(!order)return;
   const count=order.items.reduce((sum,i)=>sum+i.qty,0);$('piecesLabel').textContent=L.items(count);$('orderCount').textContent=String(order.items.length);
   $('experienceTitle').textContent=L.shopping;$('experienceDetail').textContent=L.shoppingDetail;
   if(this.state.notice==='failed')$('contextMicrocopy').textContent=L.failed;
   this.renderRows(order.items);this.renderBasket(order.items,before?.items||[],event);
   animateMoney($('displaySubtotal'),order.subtotal);animateMoney($('displayDiscount'),-order.discount);animateMoney($('displayTotal'),order.total);$('discountLine').hidden=!order.discount;
   this.renderMember(order.member);
   if(['ITEM_ADDED','ORDER_STARTED'].includes(event)){const last=order.items.find(i=>!before?.items?.some(p=>p.id===i.id))||order.items.at(-1);this.microcopy(last,count);}
   this.renderSuggestion(order.suggestion,mode);
   if(mode==='discount'){animateMoney($('rewardSaving'),order.discount);animateMoney($('rewardBefore'),order.subtotal);animateMoney($('rewardAfter'),order.total);let percentage=$('rewardPercent');if(!percentage){percentage=document.createElement('span');percentage.id='rewardPercent';$('rewardSaving').after(percentage);}percentage.textContent=L.savingPercent+' '+(order.subtotal?100*order.discount/order.subtotal:0).toFixed(1)+'%';$('displayAnnouncement').textContent=L.saved+' '+money(order.discount);}
   if(['payment','success'].includes(mode)){
    const success=mode==='success';$('completionEyebrow').textContent=success?L.successLead:L.payments[order.payment];$('completionTitle').textContent=success?L.success:L.payment;
    const school=order.items.some(i=>['notebook','pen','bag','art','colours'].includes(i.kind));$('completionDetail').textContent=order.training?L.trainingDetail:success?(school?L.successSchool:L.successDetail):L.paymentDetail;animateMoney($('completionAmount'),order.total);this.receipt(success?order.receipt:null);
   }
  },
  renderRows(items){
   const ids=new Set(items.map(i=>i.id));for(const [id,node] of this.rows)if(!ids.has(id)){this.rows.delete(id);if(!reduced)node.animate([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:'translateX(-15px)'}],{duration:160}).finished.then(()=>node.remove()).catch(()=>node.remove());else node.remove();}
   for(const item of items){let node=this.rows.get(item.id);if(!node){node=document.createElement('div');node.className='order-row';node.dataset.itemId=item.id;node.innerHTML=`<div class="row-product">${O.miniature(item)}</div><div class="row-info"><strong></strong><small></small></div><div class="row-numbers"><b></b><span></span></div>`;this.rows.set(item.id,node);$('orderLines').append(node);O.imageFallback(node);if(!reduced)node.animate([{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}],{duration:260,easing:'ease-out'});node.scrollIntoView({block:'nearest',behavior:reduced?'instant':'smooth'});}
    node.querySelector('.row-info strong').textContent=item.name;node.querySelector('.row-info small').textContent=money(item.price)+' · '+L.unit;node.querySelector('.row-numbers b').textContent=money(item.total);const qty=node.querySelector('.row-numbers span');if(qty.dataset.qty!==String(item.qty)){qty.textContent='× '+item.qty;qty.dataset.qty=item.qty;if(!reduced)qty.animate([{opacity:.35},{opacity:1}],{duration:180});}
   }
  },
  renderBasket(items,oldItems=[],event){
   const visible=[...items.filter(i=>!['bag','large'].includes(i.kind)).slice(-8),...items.filter(i=>['bag','large'].includes(i.kind)).slice(-2)];const ids=new Set(visible.map(i=>i.id));
   for(const [id,node] of this.basketNodes)if(!ids.has(id)){this.basketNodes.delete(id);if(!reduced&&event==='ITEM_REMOVED')node.animate([{transform:node.style.transform,opacity:1},{transform:'translate3d(-80px,-100px,180px) rotate(-18deg)',opacity:0}],{duration:320,easing:'ease-in'}).finished.then(()=>node.remove()).catch(()=>node.remove());else node.remove();}
   let slot=0;for(const item of visible){let node=this.basketNodes.get(item.id);const large=['bag','large'].includes(item.kind);const fresh=!node;
    if(fresh){node=document.createElement('div');node.className='basket-product';node.dataset.itemId=item.id;node.innerHTML=O.miniature(item)+`<span class="basket-quantity"></span>`;this.basketNodes.set(item.id,node);(large?$('largeProducts'):$('basketContents')).append(node);O.imageFallback(node);}
    if(!large){node.style.setProperty('--slot-x',String(4+(slot%4)*20));node.style.setProperty('--slot-z',`${-70+(slot%3)*45}px`);node.style.setProperty('--slot-rotation',`${[-13,8,-4,14][slot%4]}deg`);node.style.bottom=`${20+(slot>=4?45:0)}px`;slot++;}
    const qty=node.querySelector('.basket-quantity');qty.textContent='×'+item.qty;qty.hidden=item.qty===1;
    if(fresh&&['ITEM_ADDED','ORDER_STARTED'].includes(event)&&!oldItems.some(i=>i.id===item.id))this.fly(item,node,large);
   }
  },
  fly(item,target,large){
   if(reduced)return;target.style.opacity='0';const particle=document.createElement('div');particle.className='flying-product';particle.innerHTML=O.miniature(item,{eager:true});$('flyingProducts').append(particle);O.imageFallback(particle);
   const pen=item.kind==='pen';const destination=large?'translate3d(-210px,100px,0) rotate(-9deg) scale(1)':'translate3d(-35px,80px,-70px) rotate(-8deg) scale(.8)';
   const animation=particle.animate([{transform:`translate3d(${pen?230:180}px,-180px,180px) rotateY(-28deg) rotateZ(${pen?25:-18}deg) scale(1.25)`,opacity:0,offset:0},{transform:'translate3d(45px,-140px,120px) rotateY(-8deg) rotateZ(8deg) scale(1.12)',opacity:1,offset:.35},{transform:destination,opacity:1,offset:1}],{duration:720,easing:'cubic-bezier(.32,.08,.54,1)',fill:'forwards'});
   animation.finished.then(()=>{target.style.opacity='1';particle.remove();if(!large)$('basket3d').animate([{transform:'rotateX(-15deg) rotateY(-22deg) rotateZ(1deg)'},{transform:'rotateX(-13deg) rotateY(-22deg) rotateZ(.2deg)'},{transform:'rotateX(-15deg) rotateY(-22deg) rotateZ(1deg)'}],{duration:340,easing:'ease-out'});}).catch(()=>{target.style.opacity='1';particle.remove();});
  },
  microcopy(item,count){if(!item||Date.now()-this.lastMicrocopy<9000)return;this.lastMicrocopy=Date.now();const key=count>8?'many':this.campaign()==='school'?'school':['colours','ruler'].includes(item.kind)?'art':item.kind;const pool=L.micro[key]||L.micro.generic;let index=Math.floor(Math.random()*pool.length);if(pool[index]===this.lastPhrase)index=(index+1)%pool.length;this.lastPhrase=pool[index];$('contextMicrocopy').textContent=this.lastPhrase;},
  renderMember(member){const el=$('memberMoment');el.hidden=!member?.identified||!this.config.show_membership;if(el.hidden)return;el.innerHTML=`<strong>${escape(L.memberWelcome)}</strong><small>${escape(member.category||L.memberDetail)}${member.vouchers?' · '+escape(L.vouchers(member.vouchers)):''}</small>`;},
  renderSuggestion(item,mode){const el=$('relatedProduct');if(!item||!this.config.show_suggestions||!['shopping','discount'].includes(mode)){el.hidden=true;return;}if(this.suggestionId===item.id)return;if(Date.now()-this.lastSuggestion<25000)return;this.lastSuggestion=Date.now();this.suggestionId=item.id;el.hidden=false;el.innerHTML=`<div class="related-thumb">${O.miniature(item)}</div><div><small>${escape(L.suggestions[item.context]||L.suggestions.related)}</small><strong>${escape(item.name)}</strong><b>${escape(money(item.price))}</b><p>${escape(L.suggestionNote)}</p></div>`;O.imageFallback(el);clearTimeout(this.suggestionTimer);this.suggestionTimer=setTimeout(()=>{el.hidden=true;},14000);},
  receipt(receipt){const container=$('customerReceipt');container.hidden=!receipt?.svg;if(container.hidden)return;if(this.receiptValue===receipt.value)return;this.receiptValue=receipt.value;const parsed=new DOMParser().parseFromString(receipt.svg,'image/svg+xml');const svg=parsed.documentElement;if(svg.nodeName!=='svg')return;const tags=new Set(['svg','path','rect']);const attrs=new Set(['xmlns','viewBox','width','height','shape-rendering','x','y','d','fill']);for(const node of [svg,...svg.querySelectorAll('*')]){if(!tags.has(node.localName)){node.remove();continue;}for(const attr of [...node.attributes])if(!attrs.has(attr.name))node.removeAttribute(attr.name);}container.replaceChildren(document.importNode(svg,true));const copy=document.createElement('div');const heading=document.createElement('strong');heading.textContent=L.receipt;const detail=document.createElement('p');detail.textContent=L.receiptDetail;copy.append(heading,detail);container.append(copy);},
 };
 window.CustomerExperience=display;
 const params=new URLSearchParams(location.hash.slice(1));const channel=params.get('channel'),key=params.get('key');
 const clock=()=>{$('displayClock').textContent=new Intl.DateTimeFormat(L.locale,{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kuwait'}).format(new Date());};clock();setInterval(clock,30000);
 setInterval(()=>display.rotateWelcome(),12000);
 if(!channel||!key){$('pairingPanel').hidden=false;display.rotateWelcome();return;}
 try{const cached=JSON.parse(sessionStorage.getItem('kts-display-config:'+channel)||'null');if(cached)display.configure(cached);}catch{}
 let local;
 if('BroadcastChannel' in window){local=new BroadcastChannel(`kts-customer-${channel}-${key.slice(0,12)}`);local.onmessage=event=>{const data=event.data;if(data?.channel_id===channel&&data.type!=='REQUEST_STATE')display.accept(data,'local');};local.postMessage({type:'REQUEST_STATE',channel_id:channel});}
 let stream;
 function connectStream(){
  stream?.close();stream=new EventSource(`/api/public/customer-display/${encodeURIComponent(channel)}/events?key=${encodeURIComponent(key)}`);
  stream.addEventListener('display',event=>{try{display.sseConnected=true;display.accept(JSON.parse(event.data),'sse');}catch{}});
  stream.addEventListener('presence',event=>{try{const data=JSON.parse(event.data);display.sseConnected=true;if(!data.online&&Date.now()-display.lastLocal>35000)display.accept({type:'DISCONNECTED'});}catch{}});
  stream.onerror=()=>{display.sseConnected=false;if(Date.now()-display.lastLocal<35000)display.presence(true,'local');else display.accept({type:'DISCONNECTED'});};
 }
 connectStream();
 window.addEventListener('offline',()=>{stream?.close();display.sseConnected=false;if(Date.now()-display.lastLocal<35000)display.presence(true,'local');else display.accept({type:'DISCONNECTED'});});
 window.addEventListener('online',()=>connectStream());
 window.addEventListener('pagehide',()=>{stream?.close();local?.close();});
})();
