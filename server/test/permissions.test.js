const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kts-access-test-'));
process.env.KTS_DB_PATH=path.join(directory,'test.db');
process.env.KTS_BACKUP_DIR=path.join(directory,'backups');
const app=require('../src/app');
const d=require('../src/db');
let server,base,admin,user,token;
async function req(route,method='GET',body,auth=admin){
 const response=await fetch(base+'/api'+route,{method,headers:{...(auth?{Authorization:'Bearer '+auth}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {status:response.status,data:await response.json()};
}
test.before(async()=>{
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
 admin=(await req('/auth/login','POST',{username:'admin',password:'admin123'},null)).data.token;
 user=(await req('/users','POST',{username:'access-test',full_name:'مستخدم صلاحيات',password:'test123',role_id:'role-cashier'})).data;
 token=(await req('/auth/login','POST',{username:'access-test',password:'test123'},null)).data.token;
});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));d.db.close();if(path.dirname(directory)===os.tmpdir()&&path.basename(directory).startsWith('kts-access-test-'))fs.rmSync(directory,{recursive:true,force:true});});

test('individual grants and denials apply to existing tokens without changing the role',async()=>{
 assert.equal((await req('/products','GET',null,token)).status,403);
 let result=await req(`/users/${user.id}/permissions`,'PUT',{overrides:{catalog_manage:'allow',products_create:'deny',products_update:'deny',products_deactivate:'deny',suppliers_manage:'allow',suppliers_pay:'deny'}});
 assert.equal(result.status,200);
 assert.equal((await req('/products','GET',null,token)).status,200);
 assert.equal((await req('/products','POST',{},token)).status,403);
 assert.equal((await req('/products/missing','PUT',{},token)).status,403);
 assert.equal((await req('/products/missing','DELETE',null,token)).status,403);
 assert.equal((await req('/suppliers/payments','POST',{},token)).status,403);
 assert.equal((await req('/auth/me','GET',null,token)).data.user.role_id,'role-cashier');
 const original=await req('/auth/login','POST',{username:'cashier1',password:'cashier123'},null);
 assert.equal((await req('/products','GET',null,original.data.token)).status,403);
 result=await req(`/users/${user.id}/permissions`,'PUT',{overrides:{}});assert.equal(result.status,200);
 assert.equal((await req('/products','GET',null,token)).status,403);
});
test('invalid permissions and stale edits roll back atomically; custom changes are audited',async()=>{
 const before=(await req(`/users/${user.id}/permissions`)).data;
 assert.equal((await req(`/users/${user.id}/permissions`,'PUT',{overrides:{unknown:'allow'}})).status,400);
 assert.equal((await req(`/users/${user.id}/permissions`,'PUT',{overrides:{catalog_manage:'administrator'}})).status,400);
 assert.deepEqual((await req(`/users/${user.id}/permissions`)).data.overrides,before.overrides);
 assert.equal((await req(`/users/${user.id}/permissions`,'PUT',{version:before.version,overrides:{catalog_manage:'allow'}})).status,200);
 assert.equal((await req(`/users/${user.id}/permissions`,'PUT',{version:before.version,overrides:{catalog_manage:'deny'}})).status,409);
 assert.ok(d.get("SELECT COUNT(*) n FROM audit_logs WHERE action='user_permissions_update' AND entity_id=?",user.id).n>0);
});
test('parent access is required and permission delegation is reserved for system administrators',async()=>{
 await req(`/users/${user.id}/permissions`,'PUT',{overrides:{catalog_manage:'deny',products_create:'allow',users_manage:'allow',users_permissions:'allow'}});
 const details=(await req(`/users/${user.id}/permissions`)).data;
 assert.ok(!details.effective.includes('products_create'));
 assert.ok(!details.effective.includes('users_permissions'));
 assert.equal((await req(`/users/${user.id}/permissions`,'GET',null,token)).status,403);
 assert.equal((await req(`/users/${user.id}/permissions`,'PUT',{overrides:{}},token)).status,403);
 assert.equal((await req('/users/usr-admin','PUT',{password:'takeover'},token)).status,403);
 assert.equal((await req('/users','POST',{username:'escalation',full_name:'test',password:'test123',role_id:'role-admin'},token)).status,403);
});
test('checkout permissions also protect sync uploads and K-Net before device execution',async()=>{
 await req(`/users/${user.id}/permissions`,'PUT',{overrides:{pos_checkout:'deny',pos_member_lookup:'deny',pos_discount:'deny'}});
 assert.equal((await req('/pos/checkout','POST',{},token)).status,403);
 assert.equal((await req('/devices/knet/charge','POST',{amount:1,client_reference:'deny'},token)).status,403);
 const synced=await req('/sync/upload','POST',{transactions:[{client_transaction_id:'denied-sync',items:[]}]},token);
 assert.equal(synced.status,200);assert.equal(synced.data.results[0].success,false);
 assert.equal(d.get('SELECT COUNT(*) n FROM sales').n,0);
 const snapshot=await req('/sync/snapshot','GET',null,token);
 assert.deepEqual(snapshot.data.members,[]);assert.deepEqual(snapshot.data.rules,[]);
});
test('only the selected financial and administrative actions are blocked',async()=>{
 await req(`/users/${user.id}/permissions`,'PUT',{overrides:{reports_view:'allow',reports_export:'deny',journal_create:'deny',settings_manage:'allow',backups_download:'deny',settings_write:'deny',inventory_manage:'allow',cycle_counts_approve:'deny',suppliers_manage:'allow',purchase_orders_receive:'deny',supplier_invoices_pay:'deny',import_data:'allow',import_products:'deny'}});
 assert.equal((await req('/accounting/journal','GET',null,token)).status,200);
 assert.equal((await req('/reports/export-excel','GET',null,token)).status,403);
 assert.equal((await req('/accounting/journal','POST',{},token)).status,403);
 assert.equal((await req('/backups/missing/download','GET',null,token)).status,403);
 assert.equal((await req('/settings','PUT',{},token)).status,403);
 assert.equal((await req('/cycle-counts/missing/complete','POST',{},token)).status,403);
 assert.equal((await req('/purchase-orders/missing/receive','POST',{},token)).status,403);
 assert.equal((await req('/supplier-invoices/missing/pay','POST',{},token)).status,403);
 assert.equal((await req('/import/products','POST',{},token)).status,403);
});
test('the final administrator cannot lose access or be disabled through another account',async()=>{
 assert.equal((await req('/users/usr-admin/permissions','PUT',{overrides:{users_manage:'deny'}})).status,400);
 assert.ok((await req('/auth/me')).data.user.permissions.includes('users_permissions'));
 const secondary=(await req('/users','POST',{username:'admin-limited',full_name:'مدير محدود',role_id:'role-admin',password:'test123'})).data;
 await req(`/users/${secondary.id}/permissions`,'PUT',{overrides:{users_permissions:'deny'}});
 const limited=(await req('/auth/login','POST',{username:'admin-limited',password:'test123'},null)).data.token;
 assert.equal((await req('/users/usr-admin','PUT',{status:'inactive'},limited)).status,400);
 assert.equal(d.get("SELECT status FROM users WHERE id='usr-admin'").status,'active');
});
