// Pure HTML for every place. Used by the page, and at build time to pre-render the CV for search engines.
export const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const list = (items, cls = 'bul') => `<ul class="${cls}">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;

export function renderers(site) {
  const { profile } = site;
  const contacts = () => [
    profile.cv && { label: 'Download CV', url: profile.cv, primary: true },
    profile.email && { label: 'Email me', url: `mailto:${profile.email}` },
    profile.linkedin && { label: 'LinkedIn', url: profile.linkedin },
    profile.github && { label: 'GitHub', url: profile.github },
  ].filter(Boolean);
  const buttons = (items) => (items.length ? `<p class="links">${items.map((l) => `<a class="${l.primary ? 'primary' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</p>` : '');
  const ranked = site.projects; // already strongest first

  function projectHTML(p, nav = true) {
    return `<section class="case">
      <small class="kicker">${esc(p.category)} · ${esc(p.period)}</small>
      <h2>${esc(p.title)}</h2>
      <p class="lede">${esc(p.tagline)}</p>
      ${p.context ? `<p class="ctx">${esc(p.context)}</p>` : ''}
      <h3>The problem</h3><p>${esc(p.problem)}</p>
      <h3>What I built</h3>${list(p.built)}
      <h3>Result</h3>${list(p.result, 'bul res')}
      ${list(p.skills, 'tags')}
      ${buttons(p.links.map((l) => ({ ...l, label: `${l.label} ↗` })))}
      ${nav ? `<div class="casenav"><button class="btn" data-go="gallery">All projects</button><button class="btn primary" data-next="${esc(p.id)}">Next project →</button></div>` : ''}
    </section>`;
  }
  function aboutHTML() {
    const timeline = (rows) => `<ul class="timeline">${rows.map((r) => `<li><b>${esc(r.what)}</b><span>${esc(r.where)}${r.when ? ` · ${esc(r.when)}` : ''}</span>${r.note ? `<i>${esc(r.note)}</i>` : ''}</li>`).join('')}</ul>`;
    return `<section>
      <small class="kicker">About${profile.location ? ` · ${esc(profile.location)}` : ''}</small>
      <div class="me">${profile.photo ? `<img src="${esc(profile.photo)}" alt="${esc(profile.name)}" width="96" height="96" loading="lazy" />` : ''}<div><h2>${esc(profile.name)}</h2>
      <p class="lede">${esc(profile.headline)}</p></div></div>
      <p>${esc(profile.summary)}</p>
      ${profile.experience.length ? `<h3>Experience</h3>${timeline(profile.experience)}` : ''}
      <h3>Education</h3>${timeline(profile.education)}
      ${profile.courses?.length ? `<h3>Courses</h3>${list(profile.courses, 'tags')}` : ''}
      ${buttons(contacts())}
    </section>`;
  }
  function skillsHTML() {
    return `<section>
      <small class="kicker">Studio</small>
      <h2>Skills</h2>
      <div class="skillgrid">${site.skills.map((s, i) => `<div><em>${String(i + 1).padStart(2, '0')}</em><b>${esc(s.name)}</b><span>${esc(s.proof)}</span></div>`).join('')}</div>
    </section>`;
  }
  function galleryHTML() {
    return `<section>
      <small class="kicker">Gallery</small>
      <h2>Projects</h2>
      <p>${ranked.length} projects, from my own startup to tools I built for founders. Pick one to read the case study.</p>
      <ul class="cards">${ranked.map((p) => `<li><button data-project="${esc(p.id)}"><b>${esc(p.title)}</b><span>${esc(p.tagline)}</span>${p.stat ? `<strong>${esc(p.stat)}</strong>` : ''}<em>${esc(p.category)} · ${esc(p.period)}</em></button></li>`).join('')}</ul>
    </section>`;
  }
  function contactHTML() {
    const c = contacts();
    return `<section>
      <small class="kicker">Contact</small>
      <h2>Let’s talk</h2>
      <p>${c.length ? 'The quickest ways to reach me:' : 'Contact details are coming soon.'}</p>
      ${buttons(c)}
    </section>`;
  }
  // browsing without driving: the whole portfolio as one scrolling page, like a CV
  const resumeHTML = () => aboutHTML() + skillsHTML() + ranked.map((p) => projectHTML(p, false)).join('') + contactHTML();
  return { contacts, projectHTML, aboutHTML, skillsHTML, galleryHTML, contactHTML, resumeHTML, ranked };
}
