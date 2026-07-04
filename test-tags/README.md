# NexBanner Test Tags

Use these tags to test only the first two formats:

- Video through VAST
- Banner through JavaScript display tags

Replace `https://YOUR_DOMAIN/nexbanner` with the public URL where this project is hosted.

## Video VAST Tag

Direct VAST URL:

```text
https://YOUR_DOMAIN/nexbanner/test-tags/vast/linear-video.xml
```

VAST media file used by the tag:

```text
https://YOUR_DOMAIN/nexbanner/examples/assets/demo-video.mp4
```

## Banner JS Tag

300x250 display tag:

```html
<div id="ad-slot-300x250"></div>
<script
  src="https://YOUR_DOMAIN/nexbanner/test-tags/display/display-300x250.js"
  data-target="ad-slot-300x250"
  data-click-url="https://nexbid.com"
></script>
```

Responsive display tag:

```html
<div id="ad-slot-responsive" style="width:300px;height:250px"></div>
<script
  src="https://YOUR_DOMAIN/nexbanner/test-tags/display/display-responsive.js"
  data-target="ad-slot-responsive"
  data-width="300"
  data-height="250"
  data-image-url="https://YOUR_DOMAIN/nexbanner/examples/assets/programmatic-101.png"
  data-click-url="https://nexbid.com"
></script>
```

## Local Test URLs

When the Express demo server is running locally:

```text
http://localhost:3000/test-tags/vast/linear-video.xml
http://localhost:3000/test-tags/display/display-300x250.js
http://localhost:3000/test-tags/test-video-and-banner.html
```

