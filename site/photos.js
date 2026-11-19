// Approved resort photographs for the featured result card.
// A resort gets a photo ONLY if it has an entry here. Each entry needs verified resort identity
// and reuse rights; the full record (source, licence evidence, checksums) is in docs/IMAGE_CREDITS.md.
// Files are hosted locally under site/img/resorts/. Never hotlink, never reuse one resort's photo for another.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PFPhotos = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  return {
    "sierra-at-tahoe": {
      src: "img/resorts/sierra-at-tahoe.jpg",
      width: 1280,
      height: 320,
      position: "50% 45%",
      credit: "Photo: USDA Forest Service (public domain)",
      source: "https://commons.wikimedia.org/wiki/File:SierraAtTahoeSkiResort-Eldorado-PRW-003_(52707577153).jpg",
    },
  };
});
