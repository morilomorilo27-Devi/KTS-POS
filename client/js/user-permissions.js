/* Per-user permissions editor and presentation gates. The server is authoritative. */
(function () {
  const sectionAccess={dashboard:"dashboard_view",exceptions:"exceptions_view",movements:"inventory_movements",reorder:"reorder_view","procurement-requests":"procurement_view","purchase-orders":"purchase_orders_view","supplier-invoices":"supplier_invoices_view","cycle-counts":"cycle_counts_view","member-benefits":"member_benefits_view",purchases:"purchases_view",reports:"sales_reports_view",accounting:"accounting_view",journal:"journal_view",devices:"devices_view",backups:"backups_view"};
  for(const section of Admin.sections) if(sectionAccess[section[0]])section[2]=sectionAccess[section[0]];
  const createPermissions={products:"products_create",categories:"categories_write",members:"members_create",suppliers:"suppliers_create",users:"users_create",discounts:"discounts_create",schedules:"shifts_schedules_write"};
  const updatePermissions={products:"products_update",categories:"categories_write",members:"members_update",suppliers:"suppliers_update",users:"users_update",discounts:"discounts_update",schedules:"shifts_schedules_write"};
  const gates={
    '#checkoutButton':'pos_checkout','#holdButton':'pos_hold_cart','#heldButton':'pos_hold_cart','#memberForm':'pos_member_lookup','#lastReceiptButton':'pos_reprint',
    '[data-payment="cash"]':'pos_payment_cash','[data-payment="knet"]':'pos_payment_knet','[data-payment="split"]':'pos_payment_split',
    '#manualJournal':'journal_create','#createSuggestedOrders':'purchase_orders_create','#newRequest':'procurement_create','#newQuote':'quotes_create',
    '[data-approve-request]':'procurement_approve','[data-select-quote]':'purchase_orders_create','#newPurchaseOrder':'purchase_orders_create',
    '[data-order-send]':'purchase_orders_send','[data-order-receive]':'purchase_orders_receive','#newSupplierInvoice':'supplier_invoices_create',
    '[data-invoice-approve]':'supplier_invoices_approve','[data-invoice-pay]':'supplier_invoices_pay','#generateCycleCount':'cycle_counts_create',
    '#cycleScanForm':'cycle_counts_record','#completeCycle':'cycle_counts_approve','#memberProfileForm':'member_benefits_write',
    '#walletForm button[type="submit"],#walletForm > button:not([type])':'member_wallet_adjust','#addDependent':'member_benefits_write','#addVoucher':'member_benefits_write',
    '#specialPriceForm button,#specialPrices':'member_benefits_write','#createBackup':'backups_create','[data-backup-download]':'backups_download',
    '[data-backup-verify],[data-backup-dry]':'backups_test','#excelDaily,#excelSummary':'reports_export',
    '#printLabels':'labels_print','[data-channel]':'pos_receipt_send',
    '#returnForm > button':'returns_create','#settingsForm button':'settings_write',
    '[data-device-edit],[data-device-test]':'devices_write','#printProductLabels':'labels_print',
  };
  function gateElement(element,permission) {
    element.dataset.accessPermission=permission;
    const denied=!Auth.can(permission);
    if(denied){element.setAttribute('data-access-denied','');}
    else element.removeAttribute('data-access-denied');
  }
  function applyGates() {
    if(!Auth.user)return;
    for(const [selector,permission] of Object.entries(gates))for(const element of document.querySelectorAll(selector))gateElement(element,permission);
    for(const element of document.querySelectorAll('[data-access-permission]'))gateElement(element,element.dataset.accessPermission);
    for(const element of UI.$('adminToolbar').querySelectorAll('button')) {
      if(element.textContent==='إضافة جديد')gateElement(element,createPermissions[Admin.section]||'catalog_manage');
      if(element.textContent==='تسجيل حركة جرد')gateElement(element,'inventory_adjust');
      if(element.textContent==='تسجيل توريد')gateElement(element,'purchases_create');
      if(element.textContent==='سداد مورد')gateElement(element,'suppliers_pay');
      if(element.textContent==='تصميم وطباعة الملصقات')gateElement(element,'labels_print');
    }
    for(const element of document.querySelectorAll('[data-edit]'))gateElement(element,updatePermissions[Admin.section]||'catalog_manage');
    for(const element of document.querySelectorAll('[data-delete]'))gateElement(element,'products_deactivate');
    if(Admin.section==='products')for(const element of UI.$('adminContent').querySelectorAll('button'))if(element.textContent==='ملصق')gateElement(element,'labels_print');
    const importType=UI.$('importForm')?.querySelector('[name=type]');
    if(importType)for(const option of importType.options)option.disabled=!Auth.can('import_'+option.value);
  }
  let queued=false;
  const observer=new MutationObserver(records=>{
    if(records.some(r=>r.type==='childList')&&!queued){queued=true;queueMicrotask(()=>{queued=false;applyGates();});}
  });
  observer.observe(UI.$('appShell'),{childList:true,subtree:true});
  observer.observe(UI.$('generalModal'),{childList:true,subtree:true});
  observer.observe(UI.$('receiptModal'),{childList:true,subtree:true});

  window.UserPermissions={
    async open(id) {
      try {
        const data=await API.request(`/users/${encodeURIComponent(id)}/permissions`);
        this.data=data;this.pending={...data.overrides};
        const dialog=UI.modal('صلاحيات المستخدم — '+data.user.full_name,`<form id="userAccessForm"><div class="access-intro"><div><span class="eyebrow">تحكم دقيق بالوصول</span><h3>${UI.escape(data.user.full_name)} <small dir="ltr">${UI.escape(data.user.username)}</small></h3><p>حسب الدور يرث الإعداد الافتراضي. السماح أو المنع يخص هذا المستخدم فقط. صلاحيات الإجراءات تتطلب إتاحة القسم الأساسي.</p></div><div id="accessSummary"></div></div><div class="access-controls"><input id="accessSearch" type="search" placeholder="ابحث عن صلاحية أو إجراء"><button type="button" id="accessReset">إعادة الكل إلى حسب الدور</button></div><div id="accessGroups">${data.catalog.map(g=>`<details open class="access-group" data-access-group="${g.id}"><summary><strong>${UI.escape(g.name)}</strong><span data-group-count="${g.id}"></span></summary><div class="access-group-tools"><span>تطبيق على المجموعة</span>${[['inherit','حسب الدور'],['allow','سماح'],['deny','منع']].map(([v,l])=>`<button type="button" data-group="${g.id}" data-effect="${v}">${l}</button>`).join('')}</div>${g.permissions.map(p=>`<div class="access-row" data-access-code="${p.code}"><div><strong>${UI.escape(p.name)}</strong><small>${p.parent?'يتطلب: '+UI.escape(data.catalog.flatMap(g=>g.permissions).find(x=>x.code===p.parent)?.name||p.parent):'إتاحة أساسية للقسم'}</small></div><span class="access-default">افتراضي الدور: ${data.role_defaults.includes(p.code)?'سماح':'منع'}</span><select aria-label="${UI.escape(p.name)}" data-permission-choice="${p.code}"><option value="inherit">حسب الدور</option><option value="allow">سماح مخصص</option><option value="deny">منع مخصص</option></select><span class="access-result" data-effective="${p.code}"></span></div>`).join('')}</details>`).join('')}</div><label class="access-note">ملاحظة التعديل (اختياري)<input name="note" maxlength="300" placeholder="سبب تخصيص الصلاحيات"></label><p id="accessError" class="error" role="alert"></p><footer class="access-footer"><span id="accessChanges"></span><button type="button" data-close>إلغاء</button><button type="submit" class="primary" id="saveUserAccess">حفظ الصلاحيات</button></footer></form>`);
        dialog.classList.add('access-modal');dialog.addEventListener('close',()=>dialog.classList.remove('access-modal'),{once:true});
        for(const select of dialog.querySelectorAll('[data-permission-choice]')){select.value=this.pending[select.dataset.permissionChoice]||'inherit';select.onchange=()=>{this.change(select.dataset.permissionChoice,select.value);this.preview();};}
        for(const button of dialog.querySelectorAll('[data-effect]'))button.onclick=()=>{const group=data.catalog.find(g=>g.id===button.dataset.group);for(const p of group.permissions)this.change(p.code,button.dataset.effect);this.preview();};
        UI.$('accessReset').onclick=()=>{this.pending={};this.preview();};
        UI.$('accessSearch').oninput=()=>{const q=UI.$('accessSearch').value.trim().toLowerCase();for(const group of UI.$('accessGroups').children){let matches=0;for(const row of group.querySelectorAll('.access-row')){row.hidden=q&&!row.textContent.toLowerCase().includes(q);if(!row.hidden)matches++;}group.hidden=!matches;if(q)group.open=true;}};
        UI.$('userAccessForm').onsubmit=async event=>{
          event.preventDefault();const button=UI.$('saveUserAccess');button.disabled=true;UI.$('accessError').textContent='';
          try {await API.request(`/users/${encodeURIComponent(id)}/permissions`,'PUT',{overrides:this.pending,version:data.version,note:new FormData(event.target).get('note')});dialog.close();await Auth.refreshAccess();UI.toast('حُفظت الصلاحيات؛ يطبقها الخادم على الطلبات التالية');if(Auth.can('users_manage'))await Admin.load('users');}
          catch(error){UI.$('accessError').textContent=error.message;button.disabled=false;}
        };
        this.preview();
      } catch(error){UI.toast(error.message,true);}
    },
    change(code,effect){if(effect==='inherit')delete this.pending[code];else this.pending[code]=effect;},
    preview() {
      const data=this.data;const definitions=new Map(data.catalog.flatMap(g=>g.permissions).map(p=>[p.code,p]));const cache=new Map();
      const can=code=>{if(cache.has(code))return cache.get(code);const p=definitions.get(code);const parent=!p.parent||can(p.parent);const fallback=p.parent?(p.default_roles?p.default_roles.includes(data.user.role_id):can(p.parent)):data.role_defaults.includes(code);let value=parent&&(this.pending[code]==='deny'?false:this.pending[code]==='allow'?true:fallback);if(code==='users_permissions'&&data.user.role_id!=='role-admin')value=false;cache.set(code,value);return value;};
      let enabled=0;let changes=0;
      for(const [code] of definitions){const value=can(code);if(value)enabled++;if((this.pending[code]||'inherit')!==(data.overrides[code]||'inherit'))changes++;const select=document.querySelector(`[data-permission-choice="${code}"]`);select.value=this.pending[code]||'inherit';const result=document.querySelector(`[data-effective="${code}"]`);result.textContent=value?'مسموح فعليًا':'ممنوع فعليًا';result.classList.toggle('allowed',value);result.title=this.pending[code]==='allow'&&!value?'يتطلب إتاحة القسم الأساسي أو صفة مدير النظام':'';}
      for(const group of data.catalog)document.querySelector(`[data-group-count="${group.id}"]`).textContent=`${group.permissions.filter(p=>can(p.code)).length} / ${group.permissions.length}`;
      UI.$('accessSummary').innerHTML=`<strong>${enabled}<small>صلاحية متاحة من ${definitions.size}</small></strong><span>${Object.keys(this.pending).length} تخصيصات فردية</span>`;
      UI.$('accessChanges').textContent=`${changes} تغييرات بانتظار الحفظ`;
    },
  };
  const drawTable=Admin.drawTable;
  Admin.drawTable=function(){drawTable.call(this);if(this.section!=='users'||!Auth.can('users_permissions')||Auth.user.role_id!=='role-admin')return;for(const edit of UI.$('adminContent').querySelectorAll('[data-edit]')){const b=document.createElement('button');b.textContent='تخصيص الصلاحيات';b.dataset.userAccess=edit.dataset.edit;b.onclick=()=>UserPermissions.open(edit.dataset.edit);edit.after(b);}applyGates();};
  let refreshing=false;
  Auth.refreshAccess=async function(){
    if(refreshing||!this.user||!API.online)return;refreshing=true;
    try{
      const data=await API.request('/auth/me');const changed=data.user.access_revision!==this.user.access_revision;this.user=data.user;await Offline.set('user',this.user);
      UI.$('adminNav').hidden=!Admin.sections.some(s=>this.can(s[2]));
      for(const b of document.querySelectorAll('[data-view="pos"]'))b.hidden=!this.can('pos_sale');
      for(const b of document.querySelectorAll('[data-view="returns"]'))b.hidden=!this.can('pos_return');
      UI.$('shiftButton').hidden=!this.can('pos_sale');applyGates();
      if(changed){
        if(!this.can('pos_sale')){clearInterval(POS.syncTimer);POS.products=[];POS.members=[];POS.rules=[];await Offline.set('snapshot',null);}
        else {
          if(!this.can('pos_member_lookup')){POS.members=[];POS.member=null;POS.rule=null;}
          if(!this.can('pos_discount')){POS.rule=null;POS.rules=[];}
          if(!POS.products.length)await POS.init();
          else {await POS.calculate();POS.renderMember();}
        }
        if(this.viewName==='admin'&&!UI.$('adminNav').hidden)await Admin.init();
        else if(this.viewName==='admin')this.view(this.can('pos_sale')?'pos':this.can('pos_return')?'returns':'restricted');
        if((this.viewName==='pos'&&!this.can('pos_sale'))||(this.viewName==='returns'&&!this.can('pos_return'))){this.view(!UI.$('adminNav').hidden?'admin':this.can('pos_sale')?'pos':this.can('pos_return')?'returns':'restricted');}
        UI.toast('تم تحديث صلاحيات الوصول الخاصة بحسابك');
      }
    }catch(error){if(error.status!==401&&!error.offline)UI.toast(error.message,true);}finally{refreshing=false;}
  };
  document.addEventListener('accesschanged',()=>Auth.refreshAccess());
  window.addEventListener('focus',()=>Auth.refreshAccess());
  const restricted=document.createElement('main');restricted.id='restrictedView';restricted.hidden=true;restricted.className='empty-state';restricted.innerHTML='<strong>لا توجد شاشات متاحة لهذا الحساب</strong><p>راجع مدير النظام لتحديد صلاحيات الوصول، أو سجّل الخروج من الشريط العلوي.</p>';UI.$('appShell').append(restricted);
  const view=Auth.view;Auth.view=function(name){view.call(this,name);restricted.hidden=this.viewName!=='restricted';};
})();
