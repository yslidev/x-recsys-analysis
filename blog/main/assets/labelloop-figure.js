// The loop that closes.
//
// safety-label-user-agg consumes the stream of post-label events, rescans the
// author's recent posts, and writes labels onto the *account* based on
// windowed counts. Visibility filtering then reads those account labels on the
// next request -- which changes how the author's next post is treated, which
// produces more post labels.
//
// A cycle is the one thing a static diagram cannot show, because the argument
// is about time: each turn is invisible from inside a single request, and only
// the accumulation is visible from outside. So this figure runs the loop and
// lets you watch the account label appear on its own.

(function () {
  const HOST = document.getElementById('labelloop-figure');
  if (!HOST) return;

  const THRESHOLD = 2;        // illustrative: "windowed counts" -- the real
                              // thresholds are not in the open-source tree.
                              // Kept low so the loop closes within a few
                              // clicks; the escalation after it closes is the
                              // part worth watching.
  const STAGES = [
    { id: 'post',    label: 'a post is published' },
    { id: 'classify',label: 'Grox and the media models label it' },
    { id: 'agg',     label: 'safety-label-user-agg counts recent labels' },
    { id: 'account', label: 'an account label is written' },
    { id: 'vf',      label: 'visibility filtering reads it next request' },
  ];

  // Seeded so the figure says something on arrival: two clean posts and one
  // labelled, i.e. one short of the threshold. The reader's first click is
  // then the interesting one rather than the first of several.
  const SEED = [{ flagged: false }, { flagged: true }, { flagged: false }];
  let posts = SEED.map(p => ({ ...p }));
  let accountLabel = false;
  let running = false;
  let timers = [];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clear = () => { timers.forEach(clearTimeout); timers = []; };

  HOST.innerHTML = `
    <p class="fig-title">Labels land on your posts. They accumulate on you.</p>
    <div class="fig-legend">
      <span><i style="background:#2596be"></i>clean</span>
      <span><i style="background:#f97316"></i>labelled</span>
      <span><i style="background:#c9a227"></i>account carries a label</span>
    </div>

    <div class="ll">
      <div class="ll-ring">
        <div class="ll-col-head">one turn of the loop</div>
        ${STAGES.map((s, i) => `
          <div class="ll-stage" data-id="${s.id}">
            <span class="ll-dot"></span>
            <span class="ll-label">${s.label}</span>
            ${i < STAGES.length - 1 ? '<span class="ll-arrow">↓</span>' : ''}
          </div>`).join('')}
        <div class="ll-return">└─ and the next post starts here ─┘</div>
      </div>

      <div class="ll-state">
        <div class="ll-col-head">this author, so far</div>
        <div class="ll-account" data-labelled="false">
          <span class="ll-acc-name">the account</span>
          <span class="ll-acc-tag"></span>
        </div>
        <div class="ll-posts" aria-live="polite"></div>
        <div class="ll-controls">
          <button class="ll-go" type="button">publish a post</button>
          <button class="ll-reset" type="button">reset</button>
        </div>
        <p class="ll-read"></p>
      </div>
    </div>`;
  const ring   = HOST.querySelector('.ll-ring');
  const postsEl= HOST.querySelector('.ll-posts');
  const accEl  = HOST.querySelector('.ll-account');
  const accTag = HOST.querySelector('.ll-acc-tag');
  const read   = HOST.querySelector('.ll-read');

  const lit = id => {
    ring.querySelectorAll('.ll-stage').forEach(s =>
      s.classList.toggle('ll-on', s.dataset.id === id));
  };

  function renderPosts() {
    postsEl.innerHTML = posts.map((p, i) =>
      `<span class="ll-post${p.flagged ? ' ll-post-flagged' : ''}"
             title="post ${i + 1}${p.flagged ? ', labelled' : ''}"></span>`).join('');
    accEl.dataset.labelled = String(accountLabel);
    accTag.textContent = accountLabel ? 'labelled' : 'clean';
  }

  function publish() {
    if (running) return;
    running = true;
    clear();

    // once the account is labelled, the next post is judged more harshly --
    // that is the loop, not an extra rule
    const flagged = accountLabel ? Math.random() < 0.85 : Math.random() < 0.5;
    const step = reduced ? 0 : 620;

    const seq = [
      ['post',     () => { posts.push({ flagged: false }); renderPosts();
                           read.textContent = 'A post goes out. Nothing is known about it yet.'; }],
      ['classify', () => { posts[posts.length - 1].flagged = flagged; renderPosts();
                           read.textContent = flagged
                             ? 'The classifiers put a label on this one.'
                             : 'The classifiers find nothing.'; }],
      ['agg',      () => { const n = posts.filter(p => p.flagged).length;
                           read.textContent = `Recent labelled posts: ${n} of ${posts.length}.`; }],
      ['account',  () => { const n = posts.filter(p => p.flagged).length;
                           const was = accountLabel;
                           accountLabel = n >= THRESHOLD;
                           renderPosts();
                           read.textContent = accountLabel && !was
                             ? `${n} labelled posts crosses the threshold — the label is now on the `
                               + `account, not on any one post.`
                             : accountLabel
                               ? 'The account label stays.'
                               : 'Not enough yet. Nothing is written to the account.'; }],
      ['vf',       () => { read.textContent = accountLabel
                             ? 'Visibility filtering will read that account label on the next '
                               + 'request — so the next post is judged by what the last ones did.'
                             : 'Nothing for visibility filtering to pick up.'; }],
    ];

    seq.forEach(([id, fn], i) => {
      timers.push(setTimeout(() => { lit(id); fn(); }, i * step));
    });
    timers.push(setTimeout(() => { lit(null); running = false; }, seq.length * step));
  }

  HOST.querySelector('.ll-go').addEventListener('click', publish);
  HOST.querySelector('.ll-reset').addEventListener('click', () => {
    clear(); running = false; posts = SEED.map(p => ({ ...p })); accountLabel = false;
    renderPosts(); lit(null);
    read.textContent = 'Publish a few posts and watch where the label ends up.';
  });

  renderPosts();
  read.textContent = 'One of these three posts picked up a label. Publish another and watch '
    + 'where the next one lands.';
})();
