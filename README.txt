Coupledger site
===============
index.html          Landing page
privacy.html        Privacy Policy (DRAFT: have it reviewed before launch)
terms.html          Terms of Use  (DRAFT: have it reviewed before launch)
app/                The web app (index.html, sw.js, manifest, icons)
assets/             Stylesheet, script, self-hosted fonts, app screenshots, share image
_headers            Caching rules (Netlify / Cloudflare Pages)

1. Upload the whole folder to a static host (Netlify: drag it onto app.netlify.com/drop).
2. In index.html, replace every  YOUR-ADDRESS  with your real address (canonical link,
   social share tags and structured data).
3. In Supabase > Authentication > URL Configuration set Site URL and Redirect URL to
   https://YOUR-ADDRESS/app/
4. Have privacy.html and terms.html reviewed. Contact: hi@amortree.com. Built by Amortree Tech.

Android: the page says "Coming soon" and has no download. When the APK is ready, add it to a
downloads/ folder and replace the two "Coming soon" blocks in index.html with a download link.

The screenshots in assets/shots/ come from the real app loaded with sample data
(Aarav and Meera), not from any real household.
