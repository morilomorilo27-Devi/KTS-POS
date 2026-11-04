const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kts-display-test-'));process.env.KTS_DB_PATH=path.join(directory,'test.db');process.env.KTS_BACKUP_DIR=path.join(directory,'backups');
const app=require('../src/app'),d=require('../src/db'),machine=require('../../client/js/customer-display/state');let server,base,admin,cashier,product,pair;
async function api(route,method='GET',body,token=admin){const r=await fetch(base+'/api'+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
test.before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;admin=(await api('/auth/login','POST',{username:'admin',password:'admin123'},null)).data.token;cashier=(await api('/auth/login','POST',{username:'cashier1',password:'cashier123'},null)).data.token;product=(await api('/products','POST',{sku:'DISPLAY-1',name_ar:'دفتر مدرسي',category_id:'cat-3',sale_price:2,cost_price:1,initial_qty:20})).data;pair=(await api('/customer-display/channels','POST',{terminal_key:'terminal-one'})).data;});
test.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));d.db.close();if(path.dirname(directory)===os.tmpdir()&&path.basename(directory).startsWith('kts-display-test-'))fs.rmSync(directory,{recursive:true,force:true});});
const state=()=>({items:[{id:product.id,name:'not trusted',qty:1,total:2}],subtotal:2,discount:0,total:2,phase:'shopping',member:{category:'معلم',civil_id:'secret',phone:'secret',name:'private',vouchers:1}});
test('display state machine retains the order through reward, payment failure and reconnection',()=>{
 let s=machine.initial();s=machine.reduce(s,{type:'CONNECTED',online:true});assert.equal(s.mode,'welcome');s=machine.reduce(s,{type:'ORDER_STARTED',state:{items:[{id:'a'}],total:2}});assert.equal(s.mode,'shopping');s=machine.reduce(s,{type:'DISCOUNT_APPLIED'});assert.equal(s.mode,'discount');s=machine.reduce(s,{type:'PAYMENT_STARTED'});assert.equal(s.mode,'payment');s=machine.reduce(s,{type:'PAYMENT_FAILED'});assert.equal(s.mode,'shopping');assert.equal(s.order.total,2);s=machine.reduce(s,{type:'DISCONNECTED'});assert.equal(s.mode,'offline');s=machine.reduce(s,{type:'CONNECTED',online:true,state:{items:[{id:'a'}],phase:'shopping'}});assert.equal(s.mode,'shopping');s=machine.reduce(s,{type:'PAYMENT_SUCCESS'});assert.equal(s.mode,'success');s=machine.reduce(s,{type:'ORDER_CANCELLED',state:{items:[]}});assert.equal(s.mode,'welcome');
});
test('SSE delivers scoped snapshots, strips private data and cannot mutate sale or stock records',async()=>{
 const snapshotBefore={sales:d.get('SELECT COUNT(*) n FROM sales').n,stock:d.get('SELECT qty_on_hand FROM inventory_balances WHERE product_id=?',product.id).qty_on_hand};
 const response=await fetch(`${base}/api/public/customer-display/${pair.id}/events?key=${pair.read_key}`);assert.match(response.headers.get('content-type'),/event-stream/);const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
 const next=async()=>{while(!buffer.includes('\n\n')){const chunk=await reader.read();buffer+=decoder.decode(chunk.value,{stream:true});}const end=buffer.indexOf('\n\n'),block=buffer.slice(0,end);buffer=buffer.slice(end+2);const line=block.split('\n').find(l=>l.startsWith('data: '));return JSON.parse(line.slice(6));};
 try{assert.equal((await next()).type,'CONNECTED');assert.equal((await api(`/customer-display/channels/${pair.id}/events`,'POST',{lease:pair.lease,sequence:1,type:'ITEM_ADDED',state:state()})).data.accepted,true);const event=await next();assert.equal(event.type,'ITEM_ADDED');assert.equal(event.state.items[0].name,'دفتر مدرسي');assert.equal(event.state.items[0].kind,'notebook');assert.equal(event.state.member.name,undefined);assert.equal(event.state.member.civil_id,undefined);assert.equal(event.state.member.phone,undefined);assert.equal(event.sequence,1);
 assert.equal((await api(`/customer-display/channels/${pair.id}/events`,'POST',{lease:pair.lease,sequence:1,type:'ITEM_ADDED',state:state()})).data.accepted,false);
 assert.equal(d.get('SELECT COUNT(*) n FROM sales').n,snapshotBefore.sales);assert.equal(d.get('SELECT qty_on_hand FROM inventory_balances WHERE product_id=?',product.id).qty_on_hand,snapshotBefore.stock);
 }finally{await reader.cancel();}
});
test('channels isolate terminals and owners; public readers cannot read the global last transaction',async()=>{
 const second=(await api('/customer-display/channels','POST',{terminal_key:'terminal-two'})).data;assert.notEqual(second.id,pair.id);
 assert.equal((await api(`/customer-display/channels/${pair.id}/events`,'POST',{lease:pair.lease,sequence:2,type:'TOTAL_UPDATED',state:state()},cashier)).status,404);
 assert.equal((await api(`/customer-display/channels/${second.id}/events`,'POST',{lease:pair.lease,sequence:1,type:'TOTAL_UPDATED',state:state()})).status,409);
 const bad=await fetch(`${base}/api/public/customer-display/${pair.id}/events?key=wrong`);assert.equal(bad.status,403);
 assert.equal((await api('/public/customer-display','GET',null,null)).data.payload,null);
 const response=await fetch(`${base}/api/public/customer-display/${second.id}/events?key=${second.read_key}`);const reader=response.body.getReader();try{const text=new TextDecoder().decode((await reader.read()).value);assert.match(text,/"state":null/);}finally{await reader.cancel();}
});
test('pairing resumes the same read link and rejects stale publisher leases',async()=>{
 const next=(await api('/customer-display/channels','POST',{terminal_key:'terminal-one',read_key:pair.read_key})).data;assert.equal(next.id,pair.id);assert.equal(next.read_key,pair.read_key);assert.notEqual(next.lease,pair.lease);assert.equal((await api(`/customer-display/channels/${pair.id}/heartbeat`,'POST',{lease:pair.lease})).status,409);pair=next;
 assert.equal((await api(`/customer-display/channels/${pair.id}/events`,'POST',{lease:pair.lease,sequence:1,type:'INVALID',state:state()})).status,400);
 assert.equal((await api(`/customer-display/channels/${pair.id}/events`,'POST',{lease:pair.lease,sequence:1,type:'TOTAL_UPDATED',state:{...state(),total:-1}})).status,400);
});
test('campaigns and explicit cross-sell rules persist and require their own permission',async()=>{
 assert.equal((await api('/customer-display/settings','GET',null,cashier)).status,403);
 const cfg=(await api('/customer-display/settings')).data;
 let saved=await api('/customer-display/settings','PUT',{...cfg,campaign:'school',featured_ids:[product.id],welcome_messages:['هلا والله. نجهزك للدراسة.'],offers:[],recommendations:[{sku:'DISPLAY-1',recommended_skus:['DISPLAY-1']}]});assert.equal(saved.status,200);assert.equal((await api('/customer-display/settings')).data.recommendation_editor[0].sku,'DISPLAY-1');
 saved=await api('/customer-display/settings','PUT',{...cfg,recommendations:[{sku:'MISSING',recommended_skus:['DISPLAY-1']}]});assert.equal(saved.status,400);
 assert.equal((await api('/customer-display/settings','PUT',{...cfg,asset_url:'javascript:alert(1)'})).status,400);
});
