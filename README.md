# Millennial Clothing – Website

Static website (plain HTML/CSS/JS). Every page is a standalone file at the repo root and is linked to the others with relative links, so it works on GitHub Pages and when opened locally. The shared header/footer are injected into every page by a tiny dependency-free build script (see below) — the generated pages are committed, so GitHub Pages needs no build step.

## Publish on GitHub Pages
1. Push this folder to a GitHub repo (`main` branch).
2. Repo → **Settings → Pages → Build and deployment** → Source: *Deploy from a branch* → Branch: `main` / `(root)`.
3. Site goes live at `https://<username>.github.io/<repo>/` (open `index.html`).

## Pages

| Group | File |
|---|---|
| Home | `index.html` |
| Shop | `store-page.html`, `product-page.html`, `cart.html`, `checkout.html` |
| Account | `login.html`, `signup.html`, `forgot-password.html`, `otp-verification.html`, `social-redirect.html`, `my-profile.html`, `wishlist.html`, `quotes.html`, `track-order.html` |
| Bulk / Corporate | `bulk-landing.html`, `corporate-landing.html`, `bulk-catalog.html`, `wholesale-product-page.html`, `wholesale-product-catalogue.html`, `get-quote.html`, `bulk-orders.html`, `bulk-checkout.html` |
| Info | `about-us.html`, `contact-us.html`, `faq.html`, `size-care-guide.html`, `store-locator.html`, `privacy-policy.html`, `terms-and-conditions.html`, `return-cancellation-policy.html` |
| Components (source of truth) | `components/header.html`, `components/footer.html` |

## Main flows
- Login → `index.html` · Sign up → OTP → Login · Forgot password → Login
- Store → Product → Buy Now → Checkout → Continue Shopping → Store
- Cart → Checkout · Wishlist → Product
- Bulk catalog → Wholesale product → Get Quote → Bulk catalog
- Profile → Orders / Quotes / Carts / Wishlist / Bulk Order / Track Order · Log Out → Login

## Header / footer (build script)
Edit the header or footer **only** in `components/`, then run:

```bash
node build.js          # inject / refresh header + footer in every page   (npm run build)
node build.js --check  # exit 1 if any page is out of date (good for CI)  (npm run check)
node build.js --clean  # strip the injected blocks from every page
```

- Needs Node 14+, no `npm install`.
- Injected code lives between `<!-- build:… -->` / `<!-- /build:… -->` markers, so re-running replaces it (idempotent). Don't hand-edit inside those markers.
- Component CSS is scoped under `[data-site="header"]` / `[data-site="footer"]`, so it can't clash with a page's own styles.
- `../page.html` links inside components are rewritten per page. Commit the regenerated pages together with the component change.
- Skip a page: add it to `SKIP` in `build.js` (`404.html` is skipped) or put `<!-- build:skip -->` in the page.

## Notes
- Header/footer links in `components/` use `../` paths (rewritten by the build).
- Store filters can be opened from the URL: `store-page.html?cat=…`, `?sub=…`, `?dept=…`, `?brand=…`.
