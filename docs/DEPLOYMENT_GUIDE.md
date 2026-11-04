# دليل نشر واستضافة نظام KTS POS — جمعية المعلمين الكويتية

يهدف هذا الدليل لتوضيح خطوات نشر وتشغيل النظام لتجربته فعلياً في مكتبة جمعية المعلمين الكويتية (فرع الدسمة أو الفروع الأخرى).

---

## 1. المتطلبات الأساسية للنظام

- **Node.js**: الإصدار `22.19.0` أو أحدث (إلزامي لدعم وحدة `node:sqlite` وقواعد بيانات `DatabaseSync`).
- **قاعدة البيانات**: SQLite بنمط `WAL` ولا تحتاج لخادم خارجي، ولكنها تتطلب **قرص تخزين دائم (Persistent Disk)**.
- **شهادة SSL / HTTPS**: إلزامية للتشغيل السحابي لتمكين الـ PWA، تثبيت التطبيق، وحفظ البيانات أوفلاين عبر Service Worker.

---

## 2. خيارات النشر والتجربة التشغيلية

### الخيار (أ): الخادم المحلي داخل الفرع + نفق سحابي مجاني (الأفضل والأسرع للتجربة)
إذا كان هناك جهاز حاسوب مكتبي أو Mini-PC داخل الفرع:
1. ثبّت Node.js 22 على الجهاز.
2. شغّل النظام عبر `start.cmd` أو `npm start`.
3. لتجربة النظام من الخارج ومن الهواتف والأجهزة اللوحية دون الحاجة لـ IP ثابت أو فتح منافذ في الراوتر:
   ```bash
   # تحميل أداة Cloudflare Tunnel
   cloudflared tunnel --url http://localhost:5000
   ```
4. يمنحك الرابط الفوري رابط HTTPS موثق يعمل من أي مكان ويحقق شروط PWA و Service Worker.

---

### الخيار (ب): الاستضافة عبر Docker و Docker Compose
1. انقل مجلد المشروع إلى الخادم (VPS بنظام Ubuntu 24.04).
2. شغّل الأمر:
   ```bash
   docker compose up -d --build
   ```
3. يقوم الـ Compose تلقائياً بإنشاء حاوية Node 22 مع ربط مجلدات البيانات `database` والصور `uploads` لضمان عدم ضياع أي بيانات عند التحديث.

---

### الخيار (ج): الاستضافة المباشرة على خادم Linux VPS (Ubuntu 24.04 / Debian 12)
1. **تثبيت Node.js 22**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs
   node -v # يجب أن يظهر v22.19 أو أحدث
   ```

2. **تثبيت PM2 لإدارة الخادم وإعادة التشغيل التلقائي**:
   ```bash
   sudo npm install -g pm2
   cd /var/www/kts-pos
   npm ci --omit=dev
   pm2 start ecosystem.config.js --env production
   pm2 save
   pm2 startup
   ```

3. **إعداد خادم Nginx كـ Reverse Proxy مع دعم البث الحي (SSE)**:
   أنشئ الملف `/etc/nginx/sites-available/kts-pos`:
   ```nginx
   server {
       listen 80;
       server_name pos.kts.com.kw; # أو الدومين المخصص
       return 301 https://$host$request_uri;
   }

   server {
       listen 443 ssl http2;
       server_name pos.kts.com.kw;

       ssl_certificate /etc/letsencrypt/live/pos.kts.com.kw/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/pos.kts.com.kw/privkey.pem;

       # ضغط البيانات لتسريع التزامن وتحميل الكتالوج (16 ألف صنف)
       gzip on;
       gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;

       client_max_body_size 25M;

       location / {
           proxy_pass http://127.0.0.1:5000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;

           # إعدادات شاشة العميل والبث الحي SSE
           proxy_buffering off;
           proxy_cache off;
           proxy_read_timeout 86400s;
       }
   }
   ```
4. تفعيل الموقع وإصدار شهادة SSL المجانية:
   ```bash
   sudo ln -s /etc/nginx/sites-available/kts-pos /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   sudo certbot --nginx -d pos.kts.com.kw
   ```

---

## 3. قائمة التحقق قبل بدء التجربة الحية في الفرع (Pre-Flight Checklist)

1. [x] **تأكيد حسابات الدخول**:
   - المدير: `admin` / `admin123`
   - الكاشير: `cashier1` / `cashier123`
   - (يُنصح بتغيير كلمات المرور فور الدخول من لوحة الإدارة).
2. [x] **تحديث أسعار الأصناف المسجلة**:
   - توجد 16,059 صنف في قاعدة البيانات الحالية، بعضها سعره مسجل `0.000 د.ك` ويحتاج لتسعير أو توريد.
3. [x] **الورديات ودرج النقد**:
   - لا يمكن إتمام أي بيع دون فتح وردية للكاشير وتسجيل عهدة البداية (Opening Cash).
4. [x] **طابعات الفواتير الحرارية**:
   - الطباعة متوافقة مع ورق 80mm و 58mm و A4، يُفضّل ضبط طابعة الكاشير الافتراضية على ورق 80mm وتعطيل "Headers and Footers" في نافذة المتصفح.

