import assert from "node:assert/strict";
import { test } from "node:test";
import {
  articleCandidates,
  linkKind,
  overlap,
  paywalled,
  sameLink,
} from "../apps/server/src/news-links.ts";

test("news links: articles are told apart from home, section and topic pages", () => {
  const articles = [
    "https://www.reuters.com/world/us/storm-hits-texas-coast-2026-09-29/",
    "https://apnews.com/article/hurricane-texas-landfall-9f8e7d6c5b4a",
    "https://www.cnn.com/2026/09/29/us/houston-flooding/index.html",
    "https://www.nytimes.com/2026/09/29/us/politics/senate-vote.html",
    "https://www.bbc.com/news/articles/c0jq7y5j2l8o",
    "https://www.bbc.com/news/world-us-canada-68123456",
    "https://www.espn.com/nfl/story/_/id/41234567/texans-win",
    "https://www.khou.com/article/news/local/houston-flood-warning/285-4f1b2c3d",
    "https://www.houstonchronicle.com/news/houston-texas/article/city-council-vote-19812345.php",
    "https://www.nbcnews.com/politics/congress/shutdown-deal-reached-rcna123456",
    "https://www.theverge.com/2026/9/29/24567890/new-phone-review",
    "https://www.click2houston.com/news/local/metro-rail-line-opens-downtown/",
  ];
  for (const url of articles) assert.equal(linkKind(url), "article", url);
  const listings = [
    "https://www.reuters.com/",
    "https://apnews.com/hub/hurricanes",
    "https://www.cnn.com/us",
    "https://www.nbcnews.com/politics/congress",
    "https://www.foxnews.com/category/us/weather",
    "https://www.houstonchronicle.com/news/",
    "https://abc13.com/tag/houston-weather/",
    "https://www.bbc.com/news/topics/cx1m7zg0gzdt",
    "https://news.example/?page=2",
    "http://insecure.example/2026/09/29/story-with-a-long-headline",
  ];
  for (const url of listings) assert.equal(linkKind(url), "listing", url);
  // Unclear from the address alone: the page is read to see what it says it is.
  assert.equal(linkKind("https://local.example/news/fire-downtown"), "maybe");

  assert.equal(
    sameLink("https://www.Example.com/a/b/?utm_source=x&id=3#top"),
    "example.com/a/b?id=3",
  );
  assert.equal(paywalled("https://www.wsj.com/articles/x"), true);
  assert.equal(paywalled("https://apnews.com/article/x"), false);
  assert.ok(overlap("Texans beat Colts in overtime", "Texans beat the Colts 27-24 in OT") > 0.3);
  assert.equal(overlap("Texans beat Colts", "Weather in Houston"), 0);

  // The model's own link first when it's an article; listing pages never; free before paywalled.
  const candidates = articleCandidates(
    {
      headline: "Texans beat Colts in overtime thriller",
      url: "https://www.nytimes.com/2026/09/29/sports/texans-colts.html",
    },
    [
      { title: "NFL scores", url: "https://www.espn.com/nfl/" },
      {
        title: "Texans beat Colts in overtime",
        url: "https://www.nytimes.com/2026/09/29/sports/texans-colts.html",
      },
      {
        title: "Texans beat Colts in overtime thriller at home",
        url: "https://www.khou.com/article/sports/nfl/texans/texans-colts-overtime/285-abc123",
      },
    ],
  );
  assert.deepEqual(
    candidates.map((c) => [c.url, c.fromSearch]),
    [
      ["https://www.khou.com/article/sports/nfl/texans/texans-colts-overtime/285-abc123", true],
      ["https://www.nytimes.com/2026/09/29/sports/texans-colts.html", true],
    ],
  );
});
