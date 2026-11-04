# KTS POS — Railway preview

This package is for a fresh, separate Railway project. Do not upload the repository root or copy the local POS database to Railway.

1. Build the upload directory with `node deploy/railway/prepare-preview.cjs <prepared-demo-products.xlsx>`. The script prints the isolated directory to upload; it contains the app and a newly seeded database, not the original workbook or local database.
2. Create a single service and attach one persistent volume at `/data`. Use one replica: SQLite and the display event stream are served by the same process.
3. Before the first deployment, set separate randomly generated `KTS_PREVIEW_ADMIN_PASSWORD` and `KTS_PREVIEW_CASHIER_PASSWORD` (at least 16 characters) and a random `KTS_SALT`. Do not rotate the salt after users have been provisioned. Bootstrap passwords are consumed only when the volume has no database. Rotate passwords through user management after that.
4. Upload only the directory printed in step 1 via `railway up <directory> --path-as-root` targeting the preview service. Generate a Railway HTTPS domain on port 5000, then rename the Railway subdomain if available.
5. Verify authentication, catalogue, a demo sale, and customer display over HTTPS. Verify persistence after redeploying. For off-platform recovery, keep the encrypted backup and its encryption key in separate secure locations.

The volume stores SQLite, encrypted backup files and their key, and uploaded images. The seed contains 16,056 catalogue items, fictional suppliers and no existing members or sales. The two seed accounts are inactive and have unusable credentials until bootstrap. Keep administrative credentials separate from the cashier account shared for the trial.
