# Inside the machine: X's 2026 recommendation algorithm

A walk through the open-sourced For You pipeline, in the order it actually runs.

Code references verified against `xai-org/x-algorithm` @ `5e40600` (upstream `bc8e5f0`), 28 Aug 2026.

**Tags:** `[reach]` why your post travelled or didn't · `[shadowban]` how content gets hidden · `[eng]` implementation detail · `[recsys]` for people who build recommenders · `[policy]` a value judgment encoded in code

---

## Introduction

The X engineering team open-sourced a much larger portion of their recommendation system
earlier this month, the third update since the original release in January, and by far the
biggest. Yushan had the good fortune of being invited to review the code with the team before
it went public.

We've spent the last few weeks reading it, running it, and arguing about it, and we had more
fun than we expected to. We think you will too, and not only if you build recommender
systems. If you just use the platform and have ever wondered why one post got 10,000 views and
a near-identical one got 200, the answer is in here somewhere.

Two notes before we start. We assume you have some technical background and the patience for
something longer than a thread; in exchange, we'll try to make it more interesting than a
lecture. And everything here we read, traced, and where we could, ran ourselves.

As for why you'd read this instead of just cloning the repo: the code is organized the way
software is organized, by service, by module, by team. It is not organized the way the system
actually *runs*. So that's what we've done here instead. One post, from the moment it's
published to the moment it lands in someone's feed, in the order the machine actually touches
it.

---

# Part 1: Six verbs
`candidate-pipeline/`

`[eng]`

Every stage you are about to walk through is an instance of the same small set: go fetch things
(source), fill things in (hydrator), throw things out (filter), put a number on things
(scorer), sort and cut (selector), do something afterward (side effect).

---

# Part 2: B. fyp

In Section B, we'll go through the For You page. When a user opens a request, when the user
opens a For You page, within hundreds of milliseconds, this is what happens

### B1 · The request arrives
`home-mixer/` QueryBuilder, viewer data, opt-outs, cursors
`[eng]`

This is where the whole For You page gets initialized when a user enters the app by signaling
the home-mixer api for the timeline curation / generation for a given validated viewer_id. A
For You gRPC request hits get_for_you_feed_urt. Before any posts or ads are fetched,
QueryBuilder::build turns that request into a ScoredPostsQuery.

### B2 · Everything that isn't a post
`ForYouCandidatePipeline`: 7 parallel sources, one wraps the post pipeline
`[eng]`

So then, the section decides what appears on the timeline besides posts. These seven sources
listed below run in parallel, each contributing to a different type of item.

- Posts themselves. Sourced via ScoredPostsSource
- Ads, - AdsSource
- who to follow (wtf), WhoToFollowSource
- prompt [An onboarding / product UI injection (inline prompt, full/half cover, relevance
  prompt)], PromptsSource
- push to home [a notification-driven post pinned at the top (plus top repliers)]
  PushToHomeSource
- Jetfuel frames [topic timeline carousel cards (soccer / NFL / MLB, etc.)] JetfuelFrameSource
- Feed surveys - in-feed survey card asking for feedback about the timeline FeedSurveySource

### B3 · The system looks you up
17 hydrators, in parallel, `home-mixer/query_hydrators/`
`[eng]` `[reach]`

At B3, we look you up before looking at any post. There are 17 parallel lookups, all about the
user:

- Who you follow
- Who you blocked
- Who you muted
- Who you have engaged with recently (up to 1,024 things)
- What you have been shown
- Your language
- Your topics

Zero posts are involved yet. The system builds a picture of the reader before it fetches
anything to read. This is what we meant: it really reads the user action sequence, the graph,
and the state.

- Read user action sequence & graph and state
- User action sequence fetched twice at ranking and retrieval shapes

### B4 · Where the posts come from
Thunder · Phoenix retrieval · SimClusters ANN · TweetMixer · cached-posts fast path: `home-mixer/sources/`
`[reach]` `[recsys]`

Once we get enough understanding about the user, we try to go into several sources, including:

- Recent posts from people that you follow
- Posts that the model thinks you like from strangers
- Posts from communities that you resemble (in a couple of variants)

This results in a wide, personalized pool of around 3,000 to 4,000 posts that will be
hybrid-filtered and scored at a later stage. Right now, however, they are just ID numbers of
posts we think you will be interested in.

If (3) found ≥ 500 cached posts, has_cached_posts = true and the request takes a genuinely
different code path: only CachedPostsSource enables, all six live recall sources disable
themselves, and many downstream hydrators plus PhoenixScorer itself skip too (cached posts
carry their stored scores). It's a reuse mechanism for pagination/refresh, not a seventh recall
algorithm.

### B5 · The system looks *them* up
12 hydrators, `home-mixer/candidate_hydrators/`
`[eng]`

InNetworkCandidateHydrator · BidirectionalFollowHydrator · core post data · QuoteHydrator ·
MediaInfoHydrator · SubscriptionHydrator · GizmoduckCandidateHydrator (author data) ·
BlockedByHydrator · FilteredTopicsHydrator · LanguageCodeHydrator · EngagementCountsHydrator ·
SemanticIdHydrator

Now you get a huge list of IDs, but what are they? What really are those posts? It's like
stock; it's just paper money. The IDs are really useless on their own.

Twelve more parallel lookups fill each in: the text, the media, the person who posted it, the
language, basically the content. This process is what we call the "hydrator."

### B6 · Eighteen ways to get cut
18 filters, sequential, `home-mixer/filters/`
`[reach]`

Filters here for the obvious notes: there are 18 checks in order.

The actual execution order is:

1. Dedupe
2. Core data present
3. Age less than 48 hours
4. Not your own post
5. OON retweet reply
6. OONNsfwSimclustersFilter (NSFW / SimClusters)
7. User to retweet dedupe
8. Subscription eligible
9. Previously seen
10. Previously seen backup
11. Previously served
12. Your muted keywords
13. Block and mute in both directions
14. Brazil 2026 election
15. VideoFilter
16. TopicIdsFilter
17. New user minimum engagement
18. Inventory holdout

There are a few interesting filters at this stage:

First is the 48-hour ceiling: the max post age is 48 hours, which matches the retention system.
The two independent systems basically agree on the same number, meaning the feed supply window
is two days. After that, a post is not just suppressed, it completely ages out of the candidate
pool.

Then there is the hardcoded legal filter on the Brazil 2026 election, which includes a fixed
list of accounts excluded from recommendations, with the Brazilian electoral court's statutory
language quoted directly in the source comment, which I think is pretty interesting.

### B7 · The only stage that judges you
`phoenix/` serving + model: candidate isolation, hash embeddings
`[eng]` `[recsys]`

Read user hash embedding

Now we are finally onto AI.

Basically, in one pass, it is fed: this is this person, this is their last 1,024 actions, and
here are 3,000 posts. For each post, it returns a set of probabilities: that the user may like
it (12% chance), reply (1%), share (2%), or report it (0.01%). So the AI here, which is the
Phoenix architecture, predicts the behavior. Again, nothing is ranked; just the behavior is
predicted.

Stage B7 makes a judgment about the user. Surviving candidates go to Phoenix in a single
request carrying your action sequence and the post. It looks like: you, your history, candidate
1, candidate 2, through candidate N. An attention mask lets each candidate attend to you and
your history, but never to another candidate, enforced inside the attention kernel rather than
masked afterward.

This constraint buys three things:

1. Scoring N posts costs one pass instead of N, since the expensive history computation is
   shared.
2. A post's score does not depend on which other posts share its batch, so scores are
   comparable across requests and cacheable.
3. Serving can hand the model far more candidates than it ever saw in training.

There are two small details to reinforce:

Your history is right-anchored (the newest event always sits at the same position), and every
candidate is pinned to the same position encoding. The candidates have no order among
themselves, not even implicitly.

The cost is real: the model cannot reason about a set of posts. It cannot notice that two
candidates are near-duplicates or that the top 10 are all from one person, which is why those
problems must be filtered by stages B8, B9, and B11.

There is really no vocabulary anywhere; every ID is hashed twice into a shared table rather
than looked up in an index. Memory is fixed no matter how large the platform grows. The price
is that collisions are permanent and invisible: there is no row that belongs strictly to your
post, only a bucket shared with others.

Your learned user embedding is read as a row in the same hash table fitted during training.
Nothing about it is interpretable, no axis means anything, and it is not uniquely yours. It is
a small piece of personalization; that 1,024-event history carries far more signal than a
single user vector.

### B8 · Twenty-six numbers
`RankingScorer`: weights, offset_score, cold-start / diversity / OON adjustments, `home-mixer/scorers/`, `params/param.rs`
`[policy]` `[reach]`

```
score = Σ  wᵢ  ·  P(actionᵢ | this viewer, this post)
        └─global─┘  └──────personalized──────┘
```

The weights are global, personalization lives within the model.

Phoenix takes user action sequence [read at B3] (up to 1024 recent engagements) and learned user
embeddings [read at B7] and predict P(action) - how likely would a user react (reply/ like/
share/ report) certain posts

User graph & state [read at B3] also used

Wi is the same set of global rules

Weights here, or we call params, are the things here.

System is steered away from attention maxing (but prompted with several policy question)

---

**The 26 weights, at `5e40600`:**

| Action | Weight | Action | Weight |
|---|---|---|---|
| ShareViaCopyLink | 20.0 | PostUnexplored | 0.02 |
| Reply | 5.0 | VideoOpen | 0.07 |
| ShareViaDm | 5.0 | PhotoExpand | 0.05 |
| Quote | 5.0 | QuotedClick | 0.05 |
| FollowAuthor | 4.0 | **Dwell** | **0.05** |
| Share | 2.0 | ContDwellTime | 0.004 |
| Retweet | 1.0 | ProfileClick | 0.0 |
| Favorite | 0.5 | Vqv | 0.0 |
| Click | 0.4 | QuotedVqv | 0.0 |
| OpenLink | 0.2 | ContClickDwellTime | 0.0 |
| | | ContActiveSecs5mResidualNorm | 0.0 |
| NotDwelled | −0.02 | BlockAuthor | −31.2 |
| NotInterested | −43.2 | MuteAuthor | −58.8 |
| | | Report | −234.0 |

Positives +43.32 · Negatives −367.22.
`BidirectionalFollowReplyWeightBoost` 15.0 · `BidirectionalFollowDwellWeightBoost` 0.0
`OonWeightFactor` 0.75 · `TopicOonWeightFactor` 0.5 · `AuthorDiversityDecay` 0.5 ·
`AuthorDiversityFloor` 0.25

**Three of these changed during the August release window** (13 → 28 Aug): `Vqv` 0.05 → 0.0,
`VideoOpen` 0.05 → 0.07, and `Dwell` **0.0 → 0.05** in commit `0d3cdd8` on 25 Aug.

---

#### Policy / moral questions raised by the weights

Report at −234 means content is buried for predicted offence, not actual offence. A 1% predicted
report probability outweighs a certain like fivefold. Nobody has to report anything , 
resembling previously-reported content is sufficient. Who is over-represented in that training
signal?

Mute (−58.8) is penalised 1.9× harder than block (−31.2), inverting user intent. Block is the
stronger action. Weighting by frequency rather than intensity would produce exactly this
ordering, is that what happened, and is it intended?

Reply at 10× favorite rewards disagreement. Replies skew argumentative; likes skew approving.
The "engagement means conflict" critique now has a number attached, does weighting conversation
10× above approval systematically advantage contentious content?

Copy-link share at 20 is the top signal, and it can't tell admiration from outrage. Both get
copied and sent. Is the most-rewarded action also the most outrage-correlated one?

Dwell was 0.0 until 25 August, a real ethical choice, undercut by its own alternative.
Declining to optimise attention time is genuinely creditable. But cont_dwell_time is 0.004, the
gated dwell-regret model makes dwell the multiplicand of the entire score, and twelve days into
this release dwell itself went to 0.05. Was the zero a commitment, or a headline number while
some viewers get the opposite?

Nothing in the formula refers to a post being true, accurate, or harmful. The only harm proxies
are predicted reactions. The system has no concept of wrong, only of disliked. Everything
normative is delegated to visibility filtering's labels, which is a defensible architecture but
should be said out loud.

The two anti-concentration levers are both weak. OON at 0.75 and a diversity floor of 0.25 are
the only structural counterweights, against a model free to output arbitrarily large probability
gaps. Is the commitment to diversity real or nominal?

The bidirectional boost aims a lever at the social graph, not content. +15 reply weight for
mutual follows, 4×, advantages established reciprocal networks over new accounts. That's a
rich-get-richer mechanism, and it's the one value X has documented as deliberately tuned twice , 
launched broadly at 20 on 13 July 2026, then lowered to 15 on 24 July.

### B9 · The score gets overridden
`vm-ranker/`: greedy MAP-DPP
`[recsys]` `[policy]`

*(Moved up from the end of the document. Your own text says it runs before the top-50 selector,
and B7 promises a B9.)*

The scored candidates then go through a separate service running greedy MAP-DPP (that is, the
Determinantal Point Process), which picks a subset that is simultaneously high-quality and
mutually dissimilar. Quality comes from the score just computed; dissimilarity comes from a
cosine distance between post embeddings.

Two things to focus on here:

Unselected candidates get a score of zero. Because this runs before the top 50 selector, zeroing
is functionally just dropping, and diversity is implemented as score suppression (the codebase's
general idiom for gating).

It overrides everything upstream. VMRanker returns its own score for the posts that are
selected, so the 26 weights are subject to replacement by a model whose parameters are not in
the repository. That is an honest caveat on the entire scoring disclosure: you can read exactly
how the linear value model works, yet a separate service gets the last word.

There is another really interesting detail that we noticed when reading the codebase: when a
post embedding is missing, it is replaced by a random unit vector. To the diversity algorithm,
this looks absolutely maximally diverse, so missing data is not really penalized here.

### B10 · Sort, and keep fifty
`TopKScoreSelector`
`[eng]`

Sort by score and keep 50

### B11 · Two questions, two realities
`visibility-filtering/` (+ client): VFFilter / AncillaryVFFilter / conversation dedup
`[shadowban]`

This is the only stage that can make a post cease to exist for you. For each survivor, the
safety system decides whether to show it, blur it behind a tap, or not show it at all.
Everything before this only reorders and filters out.

For each surviving post, HomeMixer asks visibility filtering a question that gets one of three
answers: allow, interstitial, or drop. The rules evaluate in order: the first drop wins, and the
name of the deciding rule becomes the telemetry.

Very importantly, HomeMixer asks two different questions: one for in-network posts and one for
recommendations. The difference between the two is really the mechanism people mean when they
ask, "Am I getting shadowbanned?"

The two rule sets share a base, but recommendations get an extra block of drop-only rules
appended. Several signals appear with different verdicts: interstitial in-network, drop
out-of-network. If you follow the author, the post is blurred and you can tap through; if you
don't, it simply isn't seen. Same post, same label, same moment, but two different realities
decided by whether you had already chosen to see the person.

It fails open inside and fails closed on the edge. With visibility filtering, an outage in an
upstream store resolves to no blocks and no mutes, so content flows. At the boundary, the
default flips: an unresolved author is dropped, and any post ID missing from the response is
backfilled by the client as a drop.

Then, posts whose quoted posts or thread ancestors were vetoed are dropped too, and only the
highest-scoring branch of any conversation survives.

### B12 · Ads, prompts, and the slots they fill
ads blender · Who-to-Follow · prompts · survey slots: `home-mixer/selectors/`
`[eng]`

Blending basically spaces things out. Ads get spaced out, each with a safe neighbor:

- Who to follow at position 5
- A survey at position 11
- A rule that the feed should never end with an ad

Structurally, ad placement is a separate, deterministic step applied after ranking finishes. So
nothing in the 26 weights is about revenue, which is, I guess, really good.

### B13 · Served, and written down
response marshalling into a Thrift URT timeline
`[eng]`

Then, after you already have your feed, it writes down what it did: a sample of the top 50 with
the exact weights used, so tomorrow's model can learn from today's feed. And it caches the
leftovers for your next scroll.

The result is marshalled into a Thrift URT timeline, cursors, the new-posts pill, "not
interested" feedback actions, conversation modules, and capped at 47 items (RESULT_SIZE(35) +
FEED_MODULE_SLOTS(4) + MAX_JETFUEL_FRAMES_PER_RESPONSE(8); 38 is
RANKED_FOLLOWING_MAX_RESULT_SIZE, a different surface).

Then, without blocking the response, 17 side effects fire. Three matter enough to name in C4.

---

# Part 3: A. labeling

## The life of a post: from publish to "eligible candidate" (continuous, off-request)

### A1 · A post is published
Kafka `tweet_events` → content-understanding topics
`[eng]`

A post is created and immediately becomes an event on Kafka: tweet_events. From here, it takes
two entirely separate journeys that never rejoin until someone's feed is being built.

The first journey is making it available (thunder A2) . It goes into a memory store so that
people who follow the author can be served it within milliseconds.

The second makes it understood (grox A3). A battery of models and rules decide what the post is
and whether it's allowed to travel, and publishes its own set of content-understanding topics.

Neither journey knows about the other. This separation is the single most important structural
fact in the system. It is why we get questions like "Why was I ranked so low?" or "Why did my
post disappear?" All of those questions are actually about these two different machines.

### A2 · Making it fetchable
`thunder/`: feeder → in-memory author index
`[eng]`

Thunder is written in Rust. It holds every post on the platform under 48 hours old entirely in
RAM, indexed by author.

The architecture is straightforward:

- A feeder consumes the legacy event topic and transcodes it into an internal one.
- A server consumes the pre-sorted queues.

It is a very narrow job. The system is fed with the list of accounts that you follow and returns
recent posts really fast.

Key specifications:

- Retention is 48 hours.
- Sorting is purely reverse chronological.
- An algorithm field exists for choosing a ranking algorithm, it accepts "", recent, default,
  or latest, and all of them fall through to score_recent.

This confirms something people often assume isn't true: the in-network half of the feed involves
no ML at the sourcing stage. It is simply a time-ordered list of everything the people you
follow have posted in the last two days.

### A3 · Making it understood
`grox/`: two-stage PTOS classification, embeddings, topic annotations
`[shadowban]`

Grox is used to understand content. The posts you post get read, with the text and images
rendered into a single interleaved document, handled by a vision-language model, Grok in most
modes, though a 26B Gemma model is paired with Grok for three of five modes (STANDARD, RECOVERY,
LIVE_CLUSTER_ANCHORS), with Grok alone for DELUXE and BACKFILL.

The safety classification here runs in two stages:

The first is a call named "decide," which determines which broad policy categories are violated.

A focused call per violated category that pins down a specific leaf policy.

The model routing varies by category and by how much traction the post already gets. This is the
only component in the entire system that reads content (the ranking model, as we see in B7,
never does).

On the redaction, fairly stated, the prompt templates are deliberately withheld to (according to
our conversation with the X engineering team) prevent people from reverse-engineering the safety
guards and to prevent people from A/B testing their way around it. But you can see the policy
taxonomy being public, even though the wording isn't.

### A4 · Judging the picture
`media-model-proxy/` · `clip/` · `adult-content/` · `pnsfwmedia/`
`[shadowban]`

Following Grok, there are a few more media models specifically trained by the team that handles
media and trust and safety:

- A Twitter fine-tuned CLIP that produces embeddings.
- A calibrated classifier that turns those embeddings into an adult content score.
- A production fusion model that combines the image score with account-level signals.

A stateless proxy sits in front of the fleet, fetches each piece of media once, and pushes it
out to every model. The media score is then fused with an account-level health score before a
verdict.

This means the picture is judged by all the policies that go into media model policies, as well
as who posted it.

### A5 · Judging the account
`agatha/` (PMI) · `bdsm/` (behavior transformer) · `user-cred-v2/` (PageRank / reputation exemptions)
`[shadowban]`

Now you know that a post is judged by both the media model policies and the account-level
scoring. In this section, we will dive more into the account-level scoring.

There are practically three systems that score the account using very different methods:

AGATHA computes how other people react to an account (block, report, spam report) and normalizes
it per out-of-network favorite. Using the favorite as a denominator is a very neat idea: it
controls for audience reach, so a large account is not penalized simply for being seen more.

BDSM (not the BDSM you are thinking of) is a transformer over the account's chronological action
sequence, with positional encoding derived from real timestamps rather than token index. It
tracks the chronological history of the user to see the rhythm and timing of what you have done,
scoring a set of inauthentic behavior heads. Enforcement requires two thresholds to be crossed
at once, and an account near the boundary gets a liveness challenge instead of a suspension.

user-cred-v2 (user credibility) uses PageRank over the follow and engagement graphs to produce a
reputation score.

### A6 · From scores to labels
`scarecrow/` · `botmaker/` · `botmaker-rules/` · `abuse-enforcement-service/`
`[shadowban]`

Model scores are not labels: something has to decide that a score of 0.83 on some head means a
post gets marked.

There are three services around the rule engines that turn model scores into labels of some
sort: Bot Maker, Scarecrow, and Abuse Enforcement Service.

**Bot Maker:** An in-house domain-specific language for rules of the form "if this condition,
take that action," compiled and hot-reloaded on a short interval. Despite the name, it has
nothing to do with detecting bots; the "bots" here are the little automated rules themselves (in
my understanding, like the little soldiers of Trust & Safety).

**Scarecrow:** A deployed instance running on the rule package that ships in botmaker-rules.

**Abuse Enforcement Service:** The service that works on things at the account level, evaluating
rules over model score streams and issuing labels, challenges, and suspensions (with
credibility, exemptions, deduplication, and daily caps).

The account pipeline we are talking about here defaults to suspend, while the post pipeline we
talked about earlier defaults to skip. The default posture is obviously stricter for people than
for posts.

### A7 · The loop that closes
`safety-label-user-agg/`
`[shadowban]` `[policy]`

safety-label-user-agg (aggregation) closes the loop. It consumes the stream of label events that
we were mentioning from A3 to A6, rescans the author's recent posts, and writes in account-level
labels based on windowed counts, which the visibility system then reads from the next request.

So, labels on your posts get added to your account (not to the posts themselves). This changes
how your future posts are treated, which then produces more labels. The labeling process there
becomes a closed loop.

### A8 · Where the labels live
Manhattan `safety_label_store` · twemcache `slm_*` · Gizmoduck user labels
`[eng]`

All the above that we described is stored in three tiers:

- In-process cache
- Memcached tier
- Durable store

Cache lifetimes are derived from the post creation timestamp, so recently published posts
recheck their labels more often than old ones: a post under five minutes old gets a 30-second
TTL, anything older gets 60 seconds. A fresh post that gets classified sees the consequences
within half a minute.

These stores are the entire interface between the two halves of the system. The labeling pass
never calls the request pass. It just writes the labels to the store.

### A9 · Safety, applied twice
`phoenix-rankall-strato/` (with its VF gate) → `phoenix-rankall/` Parquet corpus
`[recsys]` `[shadowban]`

Before a post can be recommended to strangers, it has to enter the retrieval index, which is
what Phoenix-RankAll builds. Collections of eligible posts are windowed and materialized into
snapshots that the retrieval model loads.

The critical detail here is in the layer that decides membership: before a post joins any index,
that layer asks visibility filtering whether the post should be dropped at the recommendation
safety level (you can see the call at event processing configuration).

So safety is really applied twice, at two different times and in two different senses:

Once here at index admission, globally and in advance. A post that would be vetoed for
recommendations never becomes a retrieval candidate for anyone.

Once again at request time (via B11), per viewer, with the answer depending on who is asking.

This matters for the transparency question more than almost anything else in this repository.
"Was my post filtered?" has two possible answers at two different times, and only the second one
is personal. The first one happens before any particular reader exists.

#### Semantic ID

Semantic ID: this is the most novel thing in this release, and the part a recommender system
reader will find the most directly useful. If you are an engineer working in recommenders, you
might also find this quite interesting.

This is exactly the process of how a post becomes six tokens: rather than represent a post by an
opaque embedding, the Phoenix retrieval path quantizes embeddings into semantic IDs (six levels
of 256 centroids each, produced by a residual quantized k-means). The training loop is about 200
readable lines: fit centroids at level one, subtract to get the residual, refit the next level's
centroids on that residual, and repeat six times (in phoenix/reference/sid_codebook.py).

There are three reasons why this is really important:

It uses k-means, not a learned VAE. Semantic IDs are usually associated with the RQ-VAE
approach, which requires auxiliary training and careful handling of codebook collapse. This does
the same job with a clustering algorithm and no extra model. If you have been putting off adding
semantic IDs because of the training overhead, that objection just got weaker.

The address space is enormous, and the representation is tiny. 256 raised to the power of 6 is
roughly 2.8 × 10^14 addressable items, in just 6 tokens per post.

They are not just an index, but are truly in the user history. Semantic IDs are hydrated into
the user history at request time through a dedicated lookup service, and the retrieval tower is
then trained with them. Remove them and the checkpoint no longer loads; that is a far deeper
architectural commitment than using semantic IDs for indexing only.

### A10 · The oldest thing in the system
`simclusters/`: offline jobs + streaming indexes
`[recsys]`

SimCluster is a candidate generation method dating back to 2020, still carried forward into the
2026 release. It is definitely one of the methods from the 2020 era, sitting alongside a
transformer, and is still here because it surfaces something that the newer models don't: a
community index.

SimCluster factorizes the follow graph into roughly 145,000 communities, then propagates
community members to users, posts, and topics. A streaming layer maintains decayed
community-to-post indexes, and an ANN (approximate nearest neighbor) server answers queries under
a tight deadline.

---

# Part 4: C. Cross-cutting (each is its own topic, not a flow stage)

### C2 · Can you actually run it?
`phoenix/xrex/`: data, loss, kernels, checkpoints
`[eng]` `[recsys]`

The model in B7 has to learn somewhere: it learns from logs of feeds that have already been
served (here is what we showed someone, here is what they did, adjust, repeat). Training reads
either the live event stream or the Parquet dumps, converts them into batches, and splits them
into in-batch negatives: candidates borrowed from other users in the same batch, used as
examples of items not engaged with. The loss combines cross-entropy across the action heads with
a regression term for dwell time.

You can actually run this, which is the most reusable and coolest part of this release. They
ship a synthetic data generator, so the entire loop runs with no access to anything of theirs.

Here is what you will need:

- Linux, an NVIDIA GPU, and CUDA 12 (stated in quickstart.md). There is a macOS branch in
  pyproject.toml for a base install, but --extra engine is required for training, and its
  accelerator dependencies are Linux-gated.
- A Rust toolchain and protoc >= 3.15 (the engine is a Rust extension compiled at install time).
- uv (though if you can follow this post, you probably do not need more hand-holding on
  dependencies).

The loop has five main steps, all inside the reference folder:

1. world_snapshots.py generates a synthetic corpus plus semantic IDs.
2. dump_gen.py creates synthetic training batches.
3. train_synth.py trains the ranking model and resumes from a checkpoint.
4. bench.py --checkpoint_path verifies the checkpoint loads and serves.
5. train_synth.py with the two-tower config trains retrieval, then sid_index_server.py, two
   launch_inference.py servers, and retrieve_then_rank.py run retrieve → rank together as the
   single recommender pipeline.

What you cannot do at all here is train on real data: while the loop is real and complete, the
data is entirely synthetic.

There are also no reference metrics. We fed this back to the Twitter team, but it is very
difficult for them to provide them. Nothing tells you whether your run is correct: no expected
loss curve, no held-out numbers, and no baselines. There is only a measured timing section, which
measures wall-clock performance, not quality. If you want to know whether your training actually
worked, it is essentially just a vibe check.

### C3 · The stores are the real API
Manhattan · Kafka · Strato · caches
`[eng]`

So there's actually very little cross-service communication per se. All services write rows into
the shared database, and everyone just reads from the common knowledge of the cross-model
relationship in the system. They're all store-mediated. Except for home mixers fanning out in
scoring and filtering services, all else travel through a durable store in a Kafka topic.

This is very much a system-level insight of the whole release: the architecture is not really a
call graph, but a set of servers agreeing on a shared schema. That is why the two paths (A and
B) can develop independently, why there is really no inter-service communication, and honestly,
how we should describe a change in which the store's content is changed.

### C4 · Three feedback loops
training log · warm-cache fast path · label→account-label loop
`[policy]`

**The training log.** A sampled Kafka record of each served top-50, carrying the exact applied
weight map, so offline analysis can reproduce any score that was actually served. The cached
model request is its join key. Today's feed is tomorrow's training data.

**The warm-cache fast path.** This request's top-scoring posts are cached and become the next
request's candidate source (B4), bypassing recall and scoring entirely.

**The label loop.** Post labels aggregate into account labels, which change how future posts are
treated (A7).

Each loop is short and each is invisible from inside a single request.

### C5 · What's withheld, and what it costs
`under-the-hood/`
`[policy]`

---
