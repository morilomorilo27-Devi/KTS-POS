window.Labels = {
  selected: new Map(),
  defaults: { width:50,height:30,copies:1,font:10,barHeight:9,padding:2,gap:2,columns:3,margin:10,start:0,paper:"roll",source:"barcode",name:true,price:true,sku:true,code:true,brand:false,date:false,border:false,teacher:false,discount:15,title:"جمعية المعلمين الكويتية",layout:"product" },
  open(product) {
    this.selected = new Map(product ? [[product.id, { product, copies:1 }]] : []);
    try { this.options = {...this.defaults,...JSON.parse(localStorage.getItem("kts_label_template") || "{}")}; } catch { this.options = {...this.defaults}; }
    const o = this.options;
    const num = (key,title,min,max) => `<label>${title}<input name="${key}" type="number" min="${min}" max="${max}" value="${o[key]}" required></label>`;
    UI.modal("تصميم وطباعة ملصقات المنتجات والرفوف", `<div class="label-designer"><form id="labelOptions"><div class="form-grid"><label>نوع الملصق<select name="layout"><option value="product">ملصق منتج</option><option value="shelf">بطاقة رف</option></select></label><label>مقاس جاهز<select id="labelPreset"><option value="50,30">50 × 30 مم</option><option value="50,25">50 × 25 مم</option><option value="40,30">40 × 30 مم</option><option value="70,40">70 × 40 مم</option><option value="100,40">بطاقة رف 100 × 40 مم</option><option value="custom">مخصص</option></select></label><label>الورق<select name="paper"><option value="roll">رول حراري</option><option value="a4">ورقة A4</option></select></label><label>قيمة الباركود<select name="source"><option value="barcode">باركود الصنف؛ والمرجع عند غيابه</option><option value="sku">المرجع الداخلي SKU</option></select></label>${num("width","العرض مم",25,200)}${num("height","الارتفاع مم",20,150)}${num("copies","نسخ الصنف المضاف",1,1000)}${num("font","حجم الخط pt",6,18)}${num("barHeight","ارتفاع الباركود مم",5,35)}${num("padding","حافة الملصق مم",0,8)}${num("gap","الفاصل مم",0,10)}${num("columns","أعمدة A4",1,8)}${num("margin","هامش A4 مم",0,25)}${num("start","تخطي ملصقات بداية الورقة",0,100)}${num("discount","خصم المعلم التجريبي %",0,100)}<label>العنوان<input name="title" maxlength="90" value="${UI.escape(o.title)}"></label></div><div class="label-toggles">${[["name","اسم الصنف"],["price","سعر البيع"],["sku","المرجع الداخلي"],["code","الأرقام أسفل الباركود"],["brand","العنوان"],["date","تاريخ اليوم"],["border","حدود الملصق"],["teacher","سعر المعلم بعد النسبة المحددة"]].map(([key,title])=>`<label><input type="checkbox" name="${key}" ${o[key]?"checked":""}>${title}</label>`).join("")}</div><p>سعر المعلم للعرض على الملصق فقط وفق النسبة التي تحددها؛ لا يغيّر أسعار البيع أو قواعد الخصم.</p><button type="button" id="saveLabelTemplate">حفظ التصميم لهذا الجهاز</button></form><section><label>إضافة أصناف: اسم / باركود / SKU<input id="labelSearch" type="search" placeholder="ابحث ثم أضف الصنف"></label><div id="labelMatches"></div><div id="labelItems"></div><h3>المعاينة بالحجم النسبي</h3><div id="labelPreview"></div><p id="labelCount"></p></section></div><footer><button data-close>إغلاق</button><button id="printLabels" class="primary">طباعة الملصقات</button></footer>`);
    UI.$("generalModal").classList.add("label-modal");
    UI.$("generalModal").addEventListener("close",()=>UI.$("generalModal").classList.remove("label-modal"),{once:true});
    const form = UI.$("labelOptions");
    for (const key of ["layout","paper","source"]) form.elements[key].value=o[key];
    form.oninput=()=>this.preview();
    UI.$("labelPreset").onchange=event=>{ if(event.target.value!=="custom") { const [w,h]=event.target.value.split(","); form.elements.width.value=w;form.elements.height.value=h;this.preview(); } };
    UI.$("saveLabelTemplate").onclick=()=>{if(!form.reportValidity())return;this.read();localStorage.setItem("kts_label_template",JSON.stringify(this.options));UI.toast("حُفظ تصميم الملصق");};
    UI.$("labelSearch").oninput=()=>{
      const q=UI.$("labelSearch").value.trim().toLowerCase();
      const rows=q?Admin.rows.filter(p=>[p.name_ar,p.sku,...(p.barcodes||[])].some(v=>String(v).toLowerCase().includes(q))).slice(0,12):[];
      UI.$("labelMatches").innerHTML=rows.map(p=>`<button data-label-add="${UI.escape(p.id)}">${UI.escape(p.name_ar)} · ${UI.escape(p.sku)}</button>`).join("");
      for(const b of UI.$("labelMatches").querySelectorAll("button")) b.onclick=()=>{const p=Admin.rows.find(p=>p.id===b.dataset.labelAdd);this.selected.set(p.id,{product:p,copies:Number(form.elements.copies.value)||1});this.items();this.preview();};
    };
    UI.$("printLabels").onclick=()=>this.print(); this.items();this.preview();
  },
  read() {
    const form=UI.$("labelOptions"); const data=new FormData(form);
    for(const key of Object.keys(this.defaults)) this.options[key]=typeof this.defaults[key]==="boolean"?data.has(key):typeof this.defaults[key]==="number"?Number(data.get(key)):data.get(key);
    return this.options;
  },
  items() {
    UI.$("labelItems").innerHTML=[...this.selected].map(([id,item])=>`<div class="label-item"><span>${UI.escape(item.product.name_ar)}</span><input aria-label="عدد النسخ" data-label-qty="${id}" type="number" min="1" max="1000" value="${item.copies}"><button data-label-remove="${id}" aria-label="إزالة">×</button></div>`).join("");
    for(const input of UI.$("labelItems").querySelectorAll("input")) input.oninput=()=>{this.selected.get(input.dataset.labelQty).copies=Number(input.value);this.preview();};
    for(const b of UI.$("labelItems").querySelectorAll("button")) b.onclick=()=>{this.selected.delete(b.dataset.labelRemove);this.items();this.preview();};
  },
  markup(p) {
    const o=this.options;const value=o.source==="sku"?p.sku:(p.barcodes?.[0]||p.sku);
    if(!/^[\x20-\x7e]+$/.test(value)) throw new Error("قيمة الباركود يجب أن تكون أحرفًا لاتينية أو أرقامًا: "+p.sku);
    return `<article class="print-label ${o.layout}">${o.brand?`<small>${UI.escape(o.title)}</small>`:""}${o.name?`<strong class="label-name">${UI.escape(p.name_ar)}</strong>`:""}<div class="label-values">${o.price?`<b>${UI.money(p.sale_price)}</b>`:""}${o.sku?`<span dir="ltr">${UI.escape(p.sku)}</span>`:""}</div>${o.teacher?`<small>للمعلم: ${UI.money(p.sale_price*(1-o.discount/100))}</small>`:""}<div class="label-bars">${POS.barcode(value)}</div>${o.code?`<small dir="ltr">${UI.escape(value)}</small>`:""}${o.date?`<small>${new Date().toLocaleDateString("ar-KW")}</small>`:""}</article>`;
  },
  css() {const o=this.options;return `.print-label{width:${o.width}mm;height:${o.height}mm;padding:${o.padding}mm;border:${o.border?".2mm solid #111":"0"};overflow:hidden;display:flex;flex-direction:column;justify-content:center;gap:.5mm;text-align:center;background:#fff;font-size:${o.font}pt;break-inside:avoid;box-sizing:border-box;color:#111;font-family:Arial,sans-serif}.print-label small{font-size:.7em}.label-name{line-height:1.15;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.label-values{display:flex;justify-content:space-between;gap:1mm;align-items:center;white-space:nowrap;font-variant-numeric:tabular-nums}.label-values span{font-size:.7em}.label-bars{height:${o.barHeight}mm;min-height:${o.barHeight}mm;direction:ltr}.label-bars svg{width:100%;height:100%;display:block;stroke:none}.shelf .label-values b{font-size:1.5em}.label-sheet{display:grid;grid-template-columns:repeat(${o.paper==="roll"?1:o.columns},${o.width}mm);gap:${o.paper==="roll"?0:o.gap}mm;direction:ltr}.label-sheet article{direction:rtl}`;},
  preview() {
    this.read();const first=[...this.selected.values()][0];
    try{UI.$("labelPreview").innerHTML=`<style>${this.css()}</style>`+(first?this.markup(first.product):'<p>اختر صنفًا لمعاينة التصميم</p>');}catch(e){UI.$("labelPreview").textContent=e.message;}
    UI.$("labelCount").textContent=`${this.selected.size} صنف · ${[...this.selected.values()].reduce((s,i)=>s+(i.copies||0),0)} ملصق`;
  },
  print() {
    if(!UI.$("labelOptions").reportValidity())return;this.read();const o=this.options;
    const total=[...this.selected.values()].reduce((s,i)=>s+i.copies,0);
    if(!total||total>2000||[...this.selected.values()].some(i=>!Number.isInteger(i.copies)||i.copies<1||i.copies>1000))return UI.toast("اختر أصنافًا ونسخًا صحيحة؛ الحد 2000 ملصق للدفعة",true);
    if(o.paper==="a4"&&o.columns*o.width+(o.columns-1)*o.gap+2*o.margin>210)return UI.toast("عرض الملصقات والأعمدة يتجاوز عرض A4",true);
    try{const empty=o.paper==="a4"?'<div class="print-label"></div>'.repeat(o.start):"";const labels=[...this.selected.values()].map(i=>this.markup(i.product).repeat(i.copies)).join("");Printing.open(`<div class="label-sheet">${empty+labels}</div>`,this.css()+`@page{size:${o.paper==="a4"?"A4":`${o.width}mm ${o.height}mm`};margin:${o.paper==="a4"?o.margin:0}mm}body{margin:0}.label-sheet{width:${o.paper==="a4"?210-2*o.margin:o.width}mm}`,'ملصقات الأصناف والرفوف');}catch(e){UI.toast(e.message,true);}
  },
};
const labelToolbar = Admin.toolbar;
Admin.toolbar = function(section) { labelToolbar.call(this,section); if(section!=="products")return;const b=document.createElement("button");b.textContent="تصميم وطباعة الملصقات";b.onclick=()=>Labels.open();UI.$("adminToolbar").append(b);};
const labelDraw = Admin.drawTable;
Admin.drawTable = function() {labelDraw.call(this);if(this.section!=="products")return;for(const edit of UI.$("adminContent").querySelectorAll("[data-edit]")){const b=document.createElement("button");b.textContent="ملصق";b.onclick=()=>Labels.open(this.rows.find(p=>p.id===edit.dataset.edit));edit.after(b);}};
