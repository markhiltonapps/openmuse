/**
 * One finished page in the kit's own markup: shown to the model as the standard to meet (structure,
 * spacing, how a call to action and proof are placed) and used by the tests as a known-good page.
 * Every fact in it came from a real brief; none is invented.
 */
export const EXAMPLE_STYLE = {
  accent: "#c2410c",
  dark: "#10151c",
  headFont: "Outfit",
  bodyFont: "Plus Jakarta Sans",
} as const;

export const EXAMPLE_TITLE = "Maveric Construction | Roofing & Repairs in Spring, TX";
export const EXAMPLE_DESCRIPTION =
  "Roof replacement, roof inspections, storm and water-damage repair, fences and repairs in Spring, TX and nearby areas.";

const star = '<svg class="icon" aria-hidden="true"><use href="#i-star"/></svg>';
const stars = star.repeat(5);
const icon = (name: string) =>
  `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export const EXAMPLE_BODY = `<!-- Choices made without asking: the Google category says roofing contractor, and the reviews are about roofing, storm and water-damage repair, fences and repairs, so the page leads with roofing and storm repair and shows fences and repairs as work customers mention (the three reviews shown are about a roof replacement and a roof inspection). The three reviews name the business "Maveric Roofing", "Maveric Construction" and "Maverick Construction"; they are quoted exactly as written. No years in business, licences, insurance, prices or guarantees are claimed, because none were given. -->
<div class="banner"><div class="container"><span><span class="dot"></span>This is a custom preview built for <b>Maveric Construction</b>. Like it? Claim this website: <b>[YOUR NAME] · [YOUR PHONE] · [YOUR EMAIL]</b></span></div></div>
<header class="nav"><div class="container">
  <a class="brand" href="#top" aria-label="Maveric Construction, home"><span class="brand__mark">${icon("house")}</span><span><span class="brand__name">Maveric Construction</span><span class="brand__tag">Roofing contractor · Spring, TX</span></span></a>
  <nav class="links" aria-label="Page sections"><a href="#services">Services</a><a href="#reviews">Reviews</a><a href="#find-us">Find us</a></nav>
  <a class="btn btn--primary" href="tel:+18322814674" aria-label="Call Maveric Construction at (832) 281-4674">${icon("phone")}(832) 281-4674</a>
</div></header>
<main id="main">
<section class="hero" id="top"><div class="container">
  <div>
    <p class="eyebrow">Spring, TX and nearby areas</p>
    <h1>Roofing, storm repair and fences in Spring, TX</h1>
    <p class="lead">Roof replacement, roof inspections, storm and water-damage repair, fences and general repairs, the work customers mention in their Google reviews.</p>
    <div class="actions">
      <a class="btn btn--primary btn--lg" href="tel:+18322814674">${icon("phone")}Call Now: (832) 281-4674</a>
      <a class="btn btn--ghost btn--lg" href="#services">View Services ${icon("arrow-right")}</a>
    </div>
    <div class="proof">
      <div><span class="stars" role="img" aria-label="5 out of 5 stars">${stars}</span><span><b>5.0 stars</b> from 46 Google reviews</span></div>
      <div>${icon("map-pin")}<span>2162 Spring Stuebner Rd, Spring, TX 77389</span></div>
    </div>
  </div>
  <aside class="panel" aria-label="At a glance">
    <div class="panel__art">${icon("house")}</div>
    <dl class="facts">
      <div><dt>Service area</dt><dd>Spring, TX and nearby areas</dd></div>
      <div><dt>Hours (Mon–Fri)</dt><dd>8 AM–7 PM</dd></div>
      <div><dt>Hours (Sat / Sun)</dt><dd>Sat 9 AM–6 PM · Sun Closed</dd></div>
      <div><dt>Phone</dt><dd><a href="tel:+18322814674">(832) 281-4674</a></dd></div>
    </dl>
  </aside>
</div></section>

<section class="section" id="services"><div class="container">
  <div class="head"><p class="eyebrow">Services</p><h2 class="title">Roofing &amp; repair services</h2><p class="lead">Work customers mention in their reviews, along with services that are typical for a roofing contractor.</p></div>
  <div class="group"><h3>Work mentioned by customers</h3><span class="tag">Highlighted in reviews</span></div>
  <div class="grid grid--4">
    <div class="card"><div class="chip">${icon("house")}</div><h3>Roofing</h3><p>Roofing work, including complete roof replacements and roof inspections.</p></div>
    <div class="card"><div class="chip">${icon("cloud-rain")}</div><h3>Storm and water-damage repair</h3><p>Repairs for storm damage and water damage.</p></div>
    <div class="card"><div class="chip">${icon("fence")}</div><h3>Fences</h3><p>Fence work and related property repairs.</p></div>
    <div class="card"><div class="chip">${icon("wrench")}</div><h3>Repairs and maintenance</h3><p>General repairs and ongoing maintenance.</p></div>
  </div>
  <div class="group"><h3>Other roofing services</h3><span class="tag tag--quiet">Typical for the trade</span></div>
  <div class="grid grid--3">
    <div class="card card--row"><div class="chip chip--dark chip--sm">${icon("search")}</div><div><h3>Roof inspections</h3><p>Checking roof condition for homeowners or during the home buying process.</p></div></div>
    <div class="card card--row"><div class="chip chip--dark chip--sm">${icon("hammer")}</div><div><h3>Roof repair</h3><p>Repairing roof damage and wear.</p></div></div>
    <div class="card card--row"><div class="chip chip--dark chip--sm">${icon("house")}</div><div><h3>Roof replacement</h3><p>Full roof replacement when an existing roof needs to be replaced.</p></div></div>
    <div class="card card--row"><div class="chip chip--dark chip--sm">${icon("cloud-hail")}</div><div><h3>Storm and hail damage repair</h3><p>Evaluating and repairing roof surfaces affected by wind, hail or severe weather.</p></div></div>
    <div class="card card--row"><div class="chip chip--dark chip--sm">${icon("droplet")}</div><div><h3>Leak repair</h3><p>Locating and repairing active roof leaks and moisture intrusion points.</p></div></div>
    <div class="card card--row"><div class="chip chip--dark chip--sm">${icon("droplets")}</div><div><h3>Gutters</h3><p>Roofline gutter work to help direct rainwater away from the structure.</p></div></div>
  </div>
  <div class="strip"><p>Have a question about a roofing project in Spring, TX?</p><a class="btn btn--dark" href="tel:+18322814674">${icon("phone")}Call (832) 281-4674</a></div>
</div></section>

<section class="section section--alt" id="reviews"><div class="container">
  <div class="head head--split"><div><p class="eyebrow">Reviews</p><h2 class="title">What customers say on Google</h2><p class="lead">Real Google reviews.</p></div>
    <div class="score"><span class="stars" role="img" aria-label="5 out of 5 stars">${stars}</span><div><strong>5.0</strong><small>5.0 stars · 46 Google reviews</small></div></div></div>
  <div class="grid grid--3">
    <blockquote class="review"><p>“I recently had the pleasure of working with Maveric Roofing for a complete roof replacement, and I cannot recommend them enough! From start to finish, the entire experience was seamless and professional. The team was prompt, courteous, and extremely knowledgeable.”</p><footer><b>— Michael C.</b><span>5★, 2 years ago</span></footer></blockquote>
    <blockquote class="review"><p>“I recently had the pleasure of working with Maveric Construction for a roof replacement, and I can honestly say they live up to their word about treating customers like family. From the very first phone call, it was clear that they genuinely cared about my concerns and needs.”</p><footer><b>— Alejandra T.</b><span>5★, 2 years ago</span></footer></blockquote>
    <blockquote class="review"><p>“Called Maverick Construction for a roof inspection, which they did for free. Then they worked with us during our house buying process to insure the house we bought had a new roof that looks amazing.”</p><footer><b>— Nikki C.</b><span>5★, 2 years ago</span></footer></blockquote>
  </div>
</div></section>

<section class="section" id="find-us"><div class="container">
  <div class="head"><p class="eyebrow">Find us</p><h2 class="title">Visit or call</h2></div>
  <div class="find">
    <div class="contact">
      <div class="row"><div class="chip chip--sm">${icon("map-pin")}</div><div><small>Address</small><strong>2162 Spring Stuebner Rd, Spring, TX 77389</strong><p>Service area: Spring, TX and nearby areas</p></div></div>
      <div class="row"><div class="chip chip--sm">${icon("phone")}</div><div><small>Phone</small><strong><a href="tel:+18322814674">(832) 281-4674</a></strong></div></div>
      <div class="actions"><a class="btn btn--primary" href="tel:+18322814674">${icon("phone")}Call Now: (832) 281-4674</a><a class="btn btn--dark" href="https://www.google.com/maps/search/?api=1&amp;query=Maveric+Construction&amp;query_place_id=ChIJmfuS0lc1R4YRsyMth_j_mms" target="_blank" rel="noopener">View on Google Maps ${icon("external-link")}</a></div>
    </div>
    <div class="hours"><h3><span class="chip">${icon("clock")}</span>Hours</h3>
      <dl><div><dt>Monday – Friday</dt><dd>8 AM–7 PM</dd></div><div><dt>Saturday</dt><dd>9 AM–6 PM</dd></div><div><dt>Sunday</dt><dd class="off">Closed</dd></div></dl>
    </div>
  </div>
</div></section>
</main>
<footer class="footer"><div class="container">
  <div><b>Maveric Construction</b>2162 Spring Stuebner Rd, Spring, TX 77389 · <a href="tel:+18322814674">(832) 281-4674</a></div>
  <div class="notice">This is a custom preview built for <strong>Maveric Construction</strong>.<br>Like it? Claim this website: <strong>[YOUR NAME] · [YOUR PHONE] · [YOUR EMAIL]</strong></div>
</div></footer>
<div class="callbar"><a class="btn btn--primary btn--block btn--lg" href="tel:+18322814674" aria-label="Call Maveric Construction at (832) 281-4674">${icon("phone")}Call Now: (832) 281-4674</a></div>`;
