/* Presentation bridge only. Billing, stock, discounts and receipts keep their existing handlers. */
(function(){
 const safeImage=value=>{const s=String(value||'');return /^\/?images\/[\w./-]+$/.test(s)&&!s.includes('..')?'/'+s.replace(/^\//,''):'';};
 function kind(p){const name=p.name_ar||'';if(/حقيبة|حقيبه|شنط|backpack|bag/i.test(name))return 'bag';if(/طابعة|طابعه|printer|شاشة|كرسي/i.test(name))return 'large';if(/مسطر|ruler|منقل|مثلث/i.test(name))return 'ruler';if(/ألوان|الوان|تلوين|watercolou?r|crayon|pastel/i.test(name))return 'colours';return {'cat-1':'art','cat-2':'pen','cat-3':'notebook','cat-4':'folder'}[p.category_id]||'box';}
 const bridge={
  connection:null,local:null,sequence:0,outbox:[],sending:false,phase:null,inCheckout:false,checkoutSuccess:false,previous:null,
  async request(path,body){const response=await fetch('/api/customer-display'+path,{method:'POST',headers:{Authorization:'Bearer '+API.token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});if(!response.ok){const error=new Error('customer_display');error.status=response.status;throw error;}return response.json();},
  cacheKey(){return 'kts-customer-pair:'+Auth.user.id;},
  async terminal(){
   if(this.lockedTerminal)return this.lockedTerminal;
   const storageKey='kts-terminal:'+Auth.user.id;let terminal=sessionStorage.getItem(storageKey)||crypto.randomUUID();
   if(navigator.locks){
    const claim=id=>new Promise(resolve=>{navigator.locks.request('kts-display-terminal:'+Auth.user.id+':'+id,{ifAvailable:true},async lock=>{if(!lock){resolve(false);return;}const held=new Promise(done=>{this.releaseTerminal=done;});this.lockedTerminal=id;resolve(true);await held;}).catch(()=>resolve(false));});
    if(!await claim(terminal)){terminal=crypto.randomUUID();await claim(terminal);}
   }
   sessionStorage.setItem(storageKey,terminal);return terminal;
  },
  async init(){
   if(!Auth.user||!Auth.can('customer_display_open'))return;
   if(this.owner&&this.owner!==Auth.user.id)await this.disconnect();this.owner=Auth.user.id;
   if(!this.connection){try{this.connection=JSON.parse(sessionStorage.getItem(this.cacheKey())||'null');}catch{}}
   this.bindLocal();await this.ensure();
   clearInterval(this.heartbeatTimer);
   // A liveness heartbeat, not state polling. All basket changes are pushed by their actual events.
   this.heartbeatTimer=setInterval(()=>this.heartbeat(),12000);
  },
  async ensure(force=false){
   if(this.connecting)return this.connecting;
   if(!force&&this.ready&&this.connection)return this.connection;
   this.connecting=(async()=>{
    try{
     const terminal=await this.terminal();
     const connection=await this.request('/channels',{terminal_key:terminal,read_key:this.connection?.read_key});
     this.connection=connection;this.ready=true;this.sequence=0;this.outbox=[];this.previous=null;this.signature='';sessionStorage.setItem(this.cacheKey(),JSON.stringify(connection));this.bindLocal();this.capture();return connection;
    }catch{this.ready=false;this.capture();return this.connection;}
    finally{this.connecting=null;}
   })();return this.connecting;
  },
  bindLocal(){const c=this.connection;if(!c||!('BroadcastChannel' in window))return;const key=`kts-customer-${c.id}-${c.read_key.slice(0,12)}`;if(this.localName===key)return;this.local?.close();this.localName=key;this.local=new BroadcastChannel(key);this.local.onmessage=event=>{if(event.data?.type==='REQUEST_STATE'&&event.data.channel_id===c.id){this.local.postMessage({type:'SNAPSHOT',channel_id:c.id,epoch:this.connection.lease,sequence:this.sequence,state:this.previous||this.snapshot(),config:this.connection.config,online:true});}};},
  snapshot(){
   if(this.productSource!==POS.products){this.productSource=POS.products;this.products=new Map(POS.products.map(p=>[p.id,p]));}
   const lines=new Map((POS.totals.items||[]).map(l=>[l.product_id,l]));
   const items=POS.cart.map(line=>{const p=this.products.get(line.product_id);if(!p)return null;return {id:p.id,name:p.name_ar,price:p.sale_price,category_id:p.category_id,image:safeImage(p.image_url),kind:kind(p),qty:line.qty,total:lines.get(p.id)?.line_total??UI.round(line.qty*p.sale_price)};}).filter(Boolean);
   const member=POS.member?{identified:true,category:POS.member.category_name||'',vouchers:(POS.memberVouchers||[]).filter(v=>v.member_id===POS.member.id&&v.remaining_value>0).length}:null;
   return {items,subtotal:POS.totals.subtotal||0,discount:POS.totals.discount_total||0,total:POS.totals.net_total||0,payment:POS.payment,member,phase:this.phase||(items.length?'shopping':'welcome'),training:Boolean(POS.trainingMode),suggestion:null};
  },
  capture(){
   if(!this.connection||!Auth.can('customer_display_open'))return;
   if((this.inCheckout||this.phase==='success')&&!POS.cart.length)return;
   if(this.phase==='success'&&POS.cart.length){clearTimeout(this.resetTimer);this.phase=null;}
   const state=this.snapshot(),old=this.previous;const signature=JSON.stringify(state);
   if(signature===this.signature)return;this.signature=signature;
   const oldItems=old?.items||[],events=[];
   if(!old)events.push('SNAPSHOT');
   else if(!state.items.length&&oldItems.length)events.push('ORDER_CANCELLED');
   else {
    if(!oldItems.length&&state.items.length)events.push('ORDER_STARTED');
    if(state.items.some(i=>!oldItems.some(o=>o.id===i.id)))events.push('ITEM_ADDED');
    if(oldItems.some(i=>!state.items.some(o=>o.id===i.id)))events.push('ITEM_REMOVED');
    if(state.items.some(i=>oldItems.some(o=>o.id===i.id&&o.qty!==i.qty)))events.push('QUANTITY_CHANGED');
    else if(state.items.some(i=>oldItems.some(o=>o.id===i.id&&o.total!==i.total)))events.push('ITEM_UPDATED');
    if(JSON.stringify(state.member)!==JSON.stringify(old.member)){events.push('CUSTOMER_IDENTIFIED','LOYALTY_UPDATED');}
    const context=[POS.rule,POS.member?.id,POS.voucherCode,POS.walletAmount].join('|');
    if(state.discount>0&&(!old.discount||context!==this.discountContext))events.push('DISCOUNT_APPLIED');this.discountContext=context;
   }
   this.previous=state;
   for(const type of events.length?events:['TOTAL_UPDATED'])this.emit(type,state);
  },
  emit(type,state){const c=this.connection;if(!c)return;const sequence=++this.sequence;const envelope={type,channel_id:c.id,epoch:c.lease,sequence,state};this.local?.postMessage(envelope);if(!this.ready)return;this.outbox.push({type,sequence,state,lease:c.lease});if(this.outbox.length>40)this.outbox=[this.outbox.at(-1)];this.flush();},
  async flush(){if(this.sending||!this.ready)return;this.sending=true;try{while(this.outbox.length){const event=this.outbox.shift();try{await this.request(`/channels/${this.connection.id}/events`,event);}catch(error){if(event.lease!==this.connection?.lease)continue;this.ready=false;this.outbox=[];if(error.status===403)await this.disconnect(false);break;}}}finally{this.sending=false;if(this.outbox.length&&this.ready)this.flush();}},
  async heartbeat(){
   if(!Auth.user||!Auth.can('customer_display_open'))return this.disconnect(false);
   this.local?.postMessage({type:'PRESENCE',channel_id:this.connection.id});
   if(!this.ready)return this.ensure(true);
   try{const result=await this.request(`/channels/${this.connection.id}/heartbeat`,{lease:this.connection.lease});const button=UI.$('customerDisplayButton');if(button)button.dataset.connected=String(result.viewers>0);}catch{this.ready=false;}
  },
  async open(){
   if(!Auth.can('customer_display_open'))return UI.toast('لا تملك صلاحية شاشة العميل',true);
   const popup=window.open('about:blank','kts-customer-'+(this.connection?.id||'display'),'width=1440,height=900');
   if(!this.owner)await this.init();else await this.ensure();const c=this.connection;
   if(!c){popup?.close();return UI.toast('تعذر ربط الشاشة؛ تحقق من اتصال النظام',true);}
   const url=location.origin+'/customer-display.html#'+new URLSearchParams({channel:c.id,key:c.read_key}).toString();
   if(popup){popup.location.replace(url);UI.toast('انقل شاشة العميل إلى الشاشة المقابلة، ثم فعّل ملء الشاشة');}
   else this.pairingDialog(url);
  },
  pairingDialog(url){UI.modal('رابط شاشة العميل',`<p>الرابط خاص بشاشة هذا الكاشير. افتحه على شاشة العميل في نفس الشبكة التي يصل منها الخادم.</p><input id="customerPairLink" dir="ltr" readonly value="${UI.escape(url)}"><footer><button data-close>إغلاق</button><button id="copyCustomerPair" class="primary">نسخ الرابط</button></footer>`);UI.$('copyCustomerPair').onclick=()=>navigator.clipboard.writeText(url).then(()=>UI.toast('تم نسخ رابط الشاشة')).catch(()=>UI.$('customerPairLink').select());},
  succeeded(invoice){
   if(!this.inCheckout||POS.trainingMode||POS.reprintMode||!invoice)return;this.checkoutSuccess=true;this.phase='success';
   const prior=this.checkoutSnapshot||this.previous||this.snapshot();const byId=new Map((invoice.items||[]).map(i=>[i.product_id,i]));
   const state={...prior,items:prior.items.map(i=>({...i,total:byId.get(i.id)?.line_total??i.total})),subtotal:invoice.subtotal,discount:invoice.discount_total,total:invoice.net_total,phase:'success',sale_id:invoice.offline?undefined:invoice.id,receipt:null};
   this.previous=state;this.emit('PAYMENT_SUCCESS',state);this.emit('ORDER_COMPLETED',state);clearTimeout(this.resetTimer);this.resetTimer=setTimeout(()=>{if(!POS.cart.length&&this.phase==='success'){this.phase=null;this.signature='';this.previous=null;this.capture();}},8500);
  },
  async disconnect(notify=true){clearInterval(this.heartbeatTimer);clearTimeout(this.resetTimer);const c=this.connection;if(c){this.local?.postMessage({type:'DISCONNECTED',channel_id:c.id});if(notify&&this.ready)try{await this.request(`/channels/${c.id}/disconnect`,{lease:c.lease});}catch{}}this.local?.close();this.releaseTerminal?.();this.releaseTerminal=null;this.lockedTerminal=null;this.local=null;this.localName=null;this.connection=null;this.ready=false;this.owner=null;this.previous=null;this.signature='';},
 };
 window.CustomerDisplayBridge=bridge;
 const init=POS.init;POS.init=async function(...args){const result=await init.apply(this,args);bridge.init().catch(()=>{});return result;};
 const totals=POS.renderTotals;POS.renderTotals=function(...args){const result=totals.apply(this,args);queueMicrotask(()=>bridge.capture());return result;};
 const checkout=POS.checkout;POS.checkout=async function(...args){
  const start=Boolean(bridge.connection&&this.cart.length&&!this.busy&&Auth.shift&&Auth.can('pos_checkout')&&!this.trainingMode);
  if(!start)return checkout.apply(this,args);
  bridge.inCheckout=true;bridge.checkoutSuccess=false;bridge.phase='payment';bridge.checkoutSnapshot=bridge.snapshot();bridge.emit('PAYMENT_STARTED',bridge.checkoutSnapshot);
  try{return await checkout.apply(this,args);}finally{bridge.inCheckout=false;if(!bridge.checkoutSuccess){bridge.phase=null;const state=bridge.snapshot();bridge.previous=state;bridge.signature=JSON.stringify(state);bridge.emit('PAYMENT_FAILED',state);}bridge.checkoutSnapshot=null;}
 };
 const receipt=POS.receipt;POS.receipt=async function(invoice){bridge.succeeded(invoice);return receipt.call(this,invoice);};
 const logout=Auth.logout;Auth.logout=async function(...args){if(POS.cart.length)return logout.apply(this,args);await bridge.disconnect();return logout.apply(this,args);};
 const launch = UI.$('customerDisplayButton') || document.createElement('button');
 launch.id = 'customerDisplayButton';
 launch.dataset.accessPermission = 'customer_display_open';
 if(!launch.querySelector('i'))launch.append(document.createElement('i'));
 launch.onclick = () => bridge.open();
 launch.oncontextmenu = event => {
  event.preventDefault();
  const c = bridge.connection;
  if (c) bridge.pairingDialog(location.origin + '/customer-display.html#' + new URLSearchParams({ channel: c.id, key: c.read_key }));
 };
 if (!launch.parentElement && UI.$('helpButton')) UI.$('helpButton').before(launch);
})();
