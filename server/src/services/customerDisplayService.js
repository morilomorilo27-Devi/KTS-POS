const crypto = require("node:crypto");
const d = require("../db");
const audit = require("./auditService");
const receipts = require("./receiptService");

d.db.exec(`CREATE TABLE IF NOT EXISTS customer_display_channels(
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),terminal_key TEXT NOT NULL,
 read_key_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now')),
 UNIQUE(user_id,terminal_key));`);
const live = new Map();
const events = new Set(["SNAPSHOT","ORDER_STARTED","ITEM_ADDED","ITEM_REMOVED","ITEM_UPDATED","QUANTITY_CHANGED","DISCOUNT_APPLIED","CUSTOMER_IDENTIFIED","LOYALTY_UPDATED","TOTAL_UPDATED","PAYMENT_STARTED","PAYMENT_SUCCESS","PAYMENT_FAILED","ORDER_COMPLETED","ORDER_CANCELLED"]);
const defaults = {campaign:"everyday",starts_at:"",ends_at:"",theme:"sage",welcome_messages:[],offers:[],featured_ids:[],recommendations:[],asset_url:"",show_membership:true,show_suggestions:true};
const hash = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const text = (value,max=120) => String(value || "").replace(/[\u0000-\u001f]/g," ").slice(0,max);
function image(value) {const v=String(value||"");return /^\/?images\/[a-zA-Z0-9_./-]+$/.test(v)&&!v.includes('..')?'/'+v.replace(/^\//,''):'';}
function kind(product) {
 const name=product.name_ar||'';
 if(/حقيبة|حقيبه|شنط|backpack|bag/i.test(name))return "bag";
 if(/طابعة|طابعه|printer|شاشة|كرسي/i.test(name))return "large";
 if(/مسطر|ruler|منقل|مثلث/i.test(name))return "ruler";
 if(/ألوان|الوان|تلوين|watercolou?r|crayon|pastel/i.test(name))return "colours";
 return {"cat-1":"art","cat-2":"pen","cat-3":"notebook","cat-4":"folder"}[product.category_id]||"box";
}
function productView(p) {return {id:p.id,name:p.name_ar,price:p.sale_price,image:image(p.image_url),category_id:p.category_id,kind:kind(p)};}
function settings() {
 let saved={};try{saved=JSON.parse(d.get("SELECT config_value FROM system_configurations WHERE config_key='customer_display_settings'")?.config_value||'{}');}catch{}
 return {...defaults,...saved};
}
function configuration() {
 const cfg=settings();
 const candidates=cfg.featured_ids.length?d.all(`SELECT p.* FROM products p JOIN inventory_balances b ON b.product_id=p.id WHERE p.id IN (${cfg.featured_ids.map(()=>'?').join(',')}) AND p.status='active' AND b.qty_on_hand>0`,...cfg.featured_ids):d.all("SELECT p.* FROM products p JOIN inventory_balances b ON b.product_id=p.id WHERE p.status='active' AND b.qty_on_hand>0 AND p.image_url IS NOT NULL AND p.image_url!='' ORDER BY p.name_ar LIMIT 6");
 const logo=d.get("SELECT config_value FROM system_configurations WHERE config_key='logo_url'")?.config_value;
 return {...cfg,logo:image(logo)||'/images/logo.png',featured:candidates.map(productView),version:hash(JSON.stringify(cfg)).slice(0,12)};
}
function saveSettings(user,body) {
 const old=settings();const cfg={...defaults};
 if(!['everyday','school','auto','custom'].includes(body.campaign))d.fail('نوع الحملة غير صالح');cfg.campaign=body.campaign;
 if(!['sage','clay','ink'].includes(body.theme))d.fail('هوية الشاشة غير صالحة');cfg.theme=body.theme;
 for(const key of ['starts_at','ends_at']){const v=String(body[key]||'');if(v&&!/^\d{4}-\d{2}-\d{2}$/.test(v))d.fail('تاريخ الحملة غير صالح');cfg[key]=v;}
 if(cfg.starts_at&&cfg.ends_at&&cfg.starts_at>cfg.ends_at)d.fail('نهاية الحملة تسبق بدايتها');
 for(const key of ['welcome_messages','offers']){if(!Array.isArray(body[key])||body[key].length>8)d.fail('قائمة الرسائل غير صالحة');cfg[key]=body[key].map(v=>text(v,140)).filter(Boolean);}
 if(!Array.isArray(body.featured_ids)||body.featured_ids.length>12)d.fail('الحد الأقصى 12 منتجًا مختارًا');
 cfg.featured_ids=[...new Set(body.featured_ids.map(String))];
 for(const id of cfg.featured_ids)if(!d.get('SELECT id FROM products WHERE id=?',id))d.fail('أحد المنتجات المختارة غير موجود');
 if(!Array.isArray(body.recommendations)||body.recommendations.length>30)d.fail('قواعد المنتجات المرتبطة غير صالحة');
 cfg.recommendations=body.recommendations.map(rule=>{
  const source=rule.sku?d.get('SELECT id FROM products WHERE sku=?',String(rule.sku))?.id:d.required(rule.product_id,'صنف التوصية');
  const targets=Array.isArray(rule.recommended_skus)?rule.recommended_skus.map(sku=>d.get('SELECT id FROM products WHERE sku=?',String(sku))?.id):Array.isArray(rule.target_ids)?[...new Set(rule.target_ids.map(String))]:[];
  if(!source||targets.some(id=>!id)||targets.length>6||!targets.length||!d.get('SELECT id FROM products WHERE id=?',source))d.fail('قاعدة توصية غير صالحة');
  for(const id of targets)if(!d.get('SELECT id FROM products WHERE id=?',id))d.fail('الصنف المرتبط غير موجود');
  return {product_id:source,target_ids:targets};
 });
 cfg.asset_url=image(body.asset_url);if(body.asset_url&&!cfg.asset_url)d.fail('استخدم صورة محلية من مجلد images');
 for(const key of ['show_membership','show_suggestions'])cfg[key]=Boolean(body[key]);
 d.transaction(()=>{
  d.run("INSERT INTO system_configurations(config_key,config_value) VALUES('customer_display_settings',?) ON CONFLICT(config_key) DO UPDATE SET config_value=excluded.config_value,updated_at=datetime('now')",JSON.stringify(cfg));
  audit.record(user,'customer_display_settings','system_configurations','customer_display_settings',old,cfg);
 });
 const config=configuration();for(const channel of live.values())broadcast(channel,{type:'CONFIG',config});
 return config;
}
function channelState(id) {if(!live.has(id))live.set(id,{id,epoch:'',sequence:0,state:null,lastSeen:0,clients:new Set(),lease:''});return live.get(id);}
function ensure(user,body) {
 const terminal=d.required(body.terminal_key,'معرف شاشة الكاشير');if(!/^[\w-]{8,80}$/.test(terminal))d.fail('معرف الشاشة غير صالح');
 let row=d.get('SELECT * FROM customer_display_channels WHERE user_id=? AND terminal_key=?',user.id,terminal);
 let key=String(body.read_key||'');
 if(!row){key=crypto.randomBytes(32).toString('hex');row=d.insert('customer_display_channels',{id:d.id(),user_id:user.id,terminal_key:terminal,read_key_hash:hash(key)});}
 else if(!key||hash(key)!==row.read_key_hash){key=crypto.randomBytes(32).toString('hex');d.run('UPDATE customer_display_channels SET read_key_hash=? WHERE id=?',hash(key),row.id);const previous=live.get(row.id);if(previous)for(const client of previous.clients)client.end();}
 const channel=channelState(row.id);channel.lease=crypto.randomBytes(20).toString('hex');channel.epoch=channel.lease;channel.sequence=0;channel.state=null;channel.lastSeen=Date.now();
 return {id:row.id,read_key:key,lease:channel.lease,config:configuration()};
}
function publisher(user,id,lease){
 const row=d.get('SELECT * FROM customer_display_channels WHERE id=? AND user_id=?',id,user.id);if(!row)d.fail('شاشة العميل غير متاحة',404);
 const channel=channelState(id);if(!lease||lease!==channel.lease)d.fail('انتهى اقتران شاشة الكاشير؛ أعد فتح شاشة العميل',409);
 return channel;
}
function reader(id,key){const row=d.get('SELECT * FROM customer_display_channels WHERE id=?',id);if(!row||!key||hash(key)!==row.read_key_hash)d.fail('رابط اقتران الشاشة غير صالح',403);return channelState(id);}
function suggestion(items,cfg) {
 if(!cfg.show_suggestions||!items.length)return null;
 const ids=new Set(items.map(i=>i.id));let targetIds=[];let context='related';
 for(const rule of cfg.recommendations)if(ids.has(rule.product_id))targetIds.push(...rule.target_ids);
 let row;
 if(targetIds.length)row=d.all(`SELECT p.* FROM products p JOIN inventory_balances b ON b.product_id=p.id WHERE p.id IN (${targetIds.map(()=>'?').join(',')}) AND p.status='active' AND b.qty_on_hand>0`,...targetIds).find(p=>!ids.has(p.id));
 if(!row){
  const last=items.at(-1);let category;
  if(last.category_id==='cat-3'){category='cat-2';context='pen';}
  else if(last.kind==='bag'){category='cat-3';context='school';}
  else if(['art','colours'].includes(last.kind)){category='cat-1';context='art';}
  if(category)row=d.all("SELECT p.* FROM products p JOIN inventory_balances b ON b.product_id=p.id WHERE p.category_id=? AND p.status='active' AND b.qty_on_hand>0 ORDER BY (p.image_url IS NOT NULL AND p.image_url!='') DESC,p.name_ar LIMIT 40",category).find(p=>!ids.has(p.id)&&(context!=='art'||kind(p)==='colours'));
 }
 return row?{...productView(row),context}:null;
}
function normalize(user,input,origin) {
 if(!input||!Array.isArray(input.items)||input.items.length>250)d.fail('بيانات شاشة العميل غير صالحة');
 const items=input.items.map(item=>{
  const p=d.get('SELECT id,name_ar,sale_price,image_url,category_id FROM products WHERE id=?',String(item.id));if(!p)d.fail('صنف شاشة العميل غير موجود');
  const qty=d.number(item.qty,'الكمية',0,true);const line=d.number(item.total,'المبلغ');return {...productView(p),qty,total:d.money(line)};
 });
 if(new Set(items.map(i=>i.id)).size!==items.length)d.fail('الصنف مكرر في شاشة العميل');
 const result={items,subtotal:d.money(d.number(input.subtotal??0,'الإجمالي')),discount:d.money(d.number(input.discount??0,'الخصم')),total:d.money(d.number(input.total??0,'الصافي')),payment:['cash','knet','split'].includes(input.payment)?input.payment:'cash',phase:['welcome','shopping','payment','success'].includes(input.phase)?input.phase:items.length?'shopping':'welcome',training:Boolean(input.training),member:null,suggestion:null,receipt:null};
 if(input.member&&settings().show_membership)result.member={identified:true,category:text(input.member.category,70),vouchers:Math.max(0,Math.min(100,Number(input.member.vouchers)||0))};
 result.suggestion=suggestion(items,settings());
 if(input.sale_id){const sale=d.get('SELECT id,user_id,subtotal,discount_total,net_total FROM sales WHERE id=?',String(input.sale_id));if(!sale||sale.user_id!==user.id)d.fail('الفاتورة لا تخص شاشة الكاشير',403);const detail=receipts.details(sale.id,origin);result.receipt={value:detail.verification_value,svg:detail.qr_svg};result.subtotal=sale.subtotal;result.discount=sale.discount_total;result.total=sale.net_total;}
 return result;
}
function broadcast(channel,data){const serialized=`event: display\ndata: ${JSON.stringify(data)}\n\n`;for(const client of channel.clients){if(client.destroyed){channel.clients.delete(client);continue;}client.write(serialized);if(client.writableLength>1024*1024){client.end();channel.clients.delete(client);}}}
function publish(user,id,body,origin){
 const channel=publisher(user,id,body.lease);if(!events.has(body.type))d.fail('حدث شاشة العميل غير صالح');
 const sequence=Number(body.sequence);if(!Number.isSafeInteger(sequence)||sequence<=0)d.fail('تسلسل الحدث غير صالح');
 if(sequence<=channel.sequence)return {accepted:false,sequence:channel.sequence};
 const state=normalize(user,body.state,origin);channel.sequence=sequence;channel.state=state;channel.lastSeen=Date.now();
 const envelope={type:body.type,channel_id:id,epoch:channel.epoch,sequence,state};broadcast(channel,envelope);return {accepted:true,sequence};
}
function heartbeat(user,id,body){const channel=publisher(user,id,body.lease);channel.lastSeen=Date.now();return {online:true,viewers:channel.clients.size};}
function connect(req,res){
 const channel=reader(req.params.id,req.query.key);res.set({'Content-Type':'text/event-stream','Cache-Control':'no-store, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();
 channel.clients.add(res);
 res.write(`retry: 2000\nevent: display\ndata: ${JSON.stringify({type:'CONNECTED',channel_id:channel.id,epoch:channel.epoch,sequence:channel.sequence,state:channel.state,online:Date.now()-channel.lastSeen<35000,config:configuration()})}\n\n`);
 const timer=setInterval(()=>{const user=d.get('SELECT status FROM users WHERE id=(SELECT user_id FROM customer_display_channels WHERE id=?)',channel.id);if(user?.status!=='active'){res.end();return;}res.write(`event: presence\ndata: ${JSON.stringify({online:Date.now()-channel.lastSeen<35000})}\n\n`);},10000);timer.unref();
 req.on('close',()=>{clearInterval(timer);channel.clients.delete(res);});
}
function disconnect(user,id,body){const channel=publisher(user,id,body.lease);channel.lastSeen=0;channel.state=null;broadcast(channel,{type:'DISCONNECTED'});return {closed:true};}
function adminSettings(){const cfg=configuration();return {...cfg,featured_selection:cfg.featured_ids.map(id=>d.get('SELECT id,sku,name_ar FROM products WHERE id=?',id)),recommendation_editor:cfg.recommendations.map(rule=>({sku:d.get('SELECT sku FROM products WHERE id=?',rule.product_id)?.sku,recommended_skus:rule.target_ids.map(id=>d.get('SELECT sku FROM products WHERE id=?',id)?.sku).filter(Boolean)}))};}
function search(q){const needle=String(q||'').trim();if(needle.length<2)return [];return d.all("SELECT id,sku,name_ar,sale_price,image_url,category_id FROM products WHERE status='active' AND (name_ar LIKE ? OR sku LIKE ? OR id IN(SELECT product_id FROM product_barcodes WHERE barcode=?)) ORDER BY name_ar LIMIT 20",'%'+needle+'%','%'+needle+'%',needle).map(p=>({...productView(p),sku:p.sku}));}
module.exports={ensure,publish,heartbeat,connect,settings,configuration,saveSettings,adminSettings,search,disconnect,kind};
