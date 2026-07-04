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

## Publisher Tag for Google Ad Manager

Use this when a publisher needs one simple tag. The flow is:

1. Load VAST video demand first.
2. When video ends, load JS display demand 1.
3. After 7 seconds, refresh the same slot to JS display demand 2.

Live example:

```text
https://nexbid.uk/test-tags/publisher/example-gam-publisher-tag
```

Copy this into a Google Ad Manager custom or third-party creative:

```html
<div id="nexbid-slot-300x250"></div>
<script
  src="https://nexbid.uk/test-tags/publisher/nexbid-publisher-tag.js"
  data-target="nexbid-slot-300x250"
  data-width="300"
  data-height="250"
  data-vast-url="https://nexbid.uk/test-tags/vast/nexbid-vast-tag.xml"
  data-demand-1-url="https://nexbid.uk/test-tags/display/display-300x250.js"
  data-demand-1-image-url="https://nexbid.uk/test-tags/assets/display-1.png"
  data-demand-2-url="https://nexbid.uk/test-tags/display/display-300x250.js"
  data-demand-2-image-url="https://nexbid.uk/test-tags/assets/display-2.png"
  data-demand-refresh-ms="7000"
  data-click-url="https://nexbid.uk"
></script>
```
