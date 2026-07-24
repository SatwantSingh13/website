# NEXBID Hosted Publisher Test

This package is designed to be uploaded to a real web URL such as:

`https://test.nexbid.uk/nexbanner/`

or:

`https://yourdomain.com/nexbanner-test/`

## Upload instructions

Upload `index.html` to a public folder on your web server.

Examples:

- cPanel File Manager: upload into `public_html/nexbanner-test/`
- FTP: upload into `/public_html/nexbanner-test/`
- AWS/S3/Cloudflare Pages/Netlify: deploy `index.html` as a static page

Then open the HTTPS URL in Chrome.

## Where to place or replace the NexBanner tag

Open `index.html` in a text editor and find:

```html
<!-- PASTE OR REPLACE YOUR NEXBANNER TAG BELOW THIS LINE -->
```

Replace the tag located between that comment and:

```html
<!-- END OF NEXBANNER TAG -->
```

The package currently contains:

```html
<script
  src="https://nexbid.uk/nbx/v1.js?v=20260713-5"
  data-config-id="moneycontrol.com">
</script>
```

## What it tests

- Main NexBanner loader download
- Additional scripts loaded by the tag
- Fetch and XHR calls
- Child iframe creation
- Image and tracking-pixel creation
- JavaScript errors
- DOM mutations in the ad slot
- Visible ad content
- Browser resource timing

## Important

The page labels the placement as Price Priority with a ₹10 CPM floor, but it does not run a real Google Ad Manager auction.

For an actual GAM test, the publisher must:

1. Create a real Price Priority line item in GAM.
2. Set the line item rate to ₹10 CPM.
3. Add the NexBanner tag as the line-item creative.
4. Target a real GAM ad unit.
5. Serve that ad unit using Google Publisher Tags on the hosted test page.

This hosted page is for validating the tag, its real network requests, and its render behavior before or alongside the GAM test.
