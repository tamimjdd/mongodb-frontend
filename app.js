const API = '/api';
const PAGE_SIZE = 6;

const VIEWS = {
  notes: { title: 'My Notes', subtitle: 'Everything you have written, private to your account.' },
  posts: { title: 'Posts', subtitle: 'Public posts from every member of the workspace.' },
  users: { title: 'Users', subtitle: 'Create, update and remove accounts across the platform.' },
  allnotes: { title: 'All Notes', subtitle: 'Administrator view of every note in the database.' },
  aggregations: { title: 'Aggregations', subtitle: 'Results served by MongoDB aggregation pipelines.' },
};

const state = {
  token: localStorage.getItem('token') || '',
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  view: 'notes',
  pages: { notes: 1, posts: 1, users: 1, allnotes: 1 },
  totalPages: { notes: 1, posts: 1, users: 1, allnotes: 1 },
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------------- API ---------------- */

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(`${API}${path}`, { ...options, headers });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }

  if (res.status === 401 && state.token) {
    setSession('', null);
    throw new Error('Session expired, please sign in again');
  }
  if (!res.ok) {
    throw new Error((data && data.message) || `Request failed (${res.status})`);
  }
  return data;
}

/* ---------------- UI helpers ---------------- */

function toast(message, type = 'success') {
  const node = document.createElement('div');
  node.className = `toast toast--${type}`;
  const wrap = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = type === 'error' ? 'Something went wrong' : 'Success';
  const body = document.createElement('span');
  body.textContent = message;
  wrap.append(title, body);
  node.append(wrap);
  $('#toasts').append(node);
  setTimeout(() => node.remove(), 4200);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function initials(name = '') {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || '?';
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function parseInterests(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function emptyState(container, title, hint) {
  const box = el('div', 'empty');
  box.append(el('strong', null, title), el('span', null, hint));
  container.append(box);
}

function emptyRow(tbody, colspan, message) {
  const tr = el('tr', 'empty--row');
  const td = el('td', null, message);
  td.colSpan = colspan;
  tr.append(td);
  tbody.append(tr);
}

/* ---------------- Session ---------------- */

function setSession(token, user) {
  state.token = token || '';
  state.user = user || null;
  if (token) localStorage.setItem('token', token);
  else localStorage.removeItem('token');
  if (user) localStorage.setItem('user', JSON.stringify(user));
  else localStorage.removeItem('user');
  renderSession();
}

function renderSession() {
  const signedIn = Boolean(state.token && state.user);
  $('#authView').hidden = signedIn;
  $('#appView').hidden = !signedIn;
  if (!signedIn) return;

  const isAdmin = state.user.role === 'admin';
  $$('[data-admin-only]').forEach((node) => { node.hidden = !isAdmin; });

  $('#sidebarAvatar').textContent = initials(state.user.name);
  $('#sidebarName').textContent = state.user.name;
  $('#sidebarEmail').textContent = state.user.email;

  const badge = $('#roleBadge');
  badge.textContent = state.user.role;
  badge.className = `badge ${isAdmin ? 'badge--primary' : ''}`;

  $('#lookupUserId').value = state.user.id;

  if (!isAdmin && (state.view === 'users' || state.view === 'allnotes')) state.view = 'notes';
  setView(state.view);
}

/* ---------------- Navigation ---------------- */

function setView(view) {
  state.view = view;
  $$('.nav__item').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.view === view));
  $$('.view').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === view));
  $('#viewTitle').textContent = VIEWS[view].title;
  $('#viewSubtitle').textContent = VIEWS[view].subtitle;

  const loaders = {
    notes: loadNotes,
    posts: loadPosts,
    users: loadUsers,
    allnotes: loadAllNotes,
  };
  if (loaders[view]) loaders[view]().catch((err) => toast(err.message, 'error'));
}

/* ---------------- Pagination ---------------- */

function updatePager(key, data) {
  const pager = $(`[data-pager="${key}"]`);
  const totalPages = data.totalPages || 1;
  state.totalPages[key] = totalPages;
  $('[data-page-info]', pager).textContent = `Page ${data.page} of ${totalPages} · ${data.total} total`;
  $('[data-page-prev]', pager).disabled = data.page <= 1;
  $('[data-page-next]', pager).disabled = data.page >= totalPages;
}

function wirePagers() {
  $$('[data-pager]').forEach((pager) => {
    const key = pager.dataset.pager;
    const loaders = { notes: loadNotes, posts: loadPosts, users: loadUsers, allnotes: loadAllNotes };
    const go = async (delta) => {
      const next = state.pages[key] + delta;
      if (next < 1 || next > state.totalPages[key]) return;
      state.pages[key] = next;
      try {
        await loaders[key]();
      } catch (err) {
        state.pages[key] -= delta;
        toast(err.message, 'error');
      }
    };
    $('[data-page-prev]', pager).addEventListener('click', () => go(-1));
    $('[data-page-next]', pager).addEventListener('click', () => go(1));
  });
}

/* ---------------- Loaders ---------------- */

async function loadNotes() {
  const data = await api(`/notes/mine?page=${state.pages.notes}&limit=${PAGE_SIZE}`);
  const list = $('#notesList');
  list.innerHTML = '';
  $('#notesCount').textContent = `${data.total} note${data.total === 1 ? '' : 's'}`;

  if (!data.data.length) {
    emptyState(list, 'No notes yet', 'Create your first note to get started.');
  }

  data.data.forEach((note) => {
    const card = el('article', 'item');
    card.append(el('h3', 'item__title', note.title), el('p', 'item__body', note.content));

    const foot = el('div', 'item__foot');
    foot.append(el('span', 'item__meta', formatDate(note.updatedAt || note.createdAt)));

    const actions = el('div', 'item__actions');
    const edit = el('button', 'btn btn--ghost btn--sm', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => openNoteModal(note));

    const del = el('button', 'btn btn--danger btn--sm', 'Delete');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete "${note.title}"?`)) return;
      try {
        await api(`/notes/${note.id}`, { method: 'DELETE' });
        toast('Note deleted');
        await loadNotes();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    actions.append(edit, del);
    foot.append(actions);
    card.append(foot);
    list.append(card);
  });

  updatePager('notes', data);
}

async function loadPosts() {
  const data = await api(`/posts?page=${state.pages.posts}&limit=${PAGE_SIZE}`);
  const list = $('#postsList');
  list.innerHTML = '';
  $('#postsCount').textContent = `${data.total} post${data.total === 1 ? '' : 's'}`;

  if (!data.data.length) {
    emptyState(list, 'No posts yet', 'Publish a post to see it here.');
  }

  data.data.forEach((post) => {
    const card = el('article', 'item');
    card.append(el('h3', 'item__title', post.title), el('p', 'item__body', post.body));

    const foot = el('div', 'item__foot');
    foot.append(el('span', 'item__meta', formatDate(post.createdAt)));

    const isMine = state.user && post.userId === state.user.id;
    foot.append(el('span', `badge ${isMine ? 'badge--success' : ''}`, isMine ? 'You' : 'Member'));
    card.append(foot);
    list.append(card);
  });

  updatePager('posts', data);
}

async function loadUsers() {
  const data = await api(`/users?page=${state.pages.users}&limit=${PAGE_SIZE}`);
  const tbody = $('#usersRows');
  tbody.innerHTML = '';
  $('#usersCount').textContent = `${data.total} account${data.total === 1 ? '' : 's'}`;

  if (!data.data.length) {
    emptyRow(tbody, 5, 'No users found.');
  }

  data.data.forEach((user) => {
    const tr = el('tr');

    const userCell = el('td');
    const wrap = el('div', 'cell-user');
    wrap.append(el('span', 'avatar avatar--sm', initials(user.name)));
    const meta = el('div', 'cell-user__meta');
    meta.append(el('strong', null, user.name), el('small', null, user.email));
    wrap.append(meta);
    userCell.append(wrap);

    const roleCell = el('td');
    roleCell.append(el('span', `badge ${user.role === 'admin' ? 'badge--primary' : ''}`, user.role));

    const interestCell = el('td');
    const chips = el('div', 'chips');
    if ((user.interests || []).length) {
      user.interests.forEach((interest) => chips.append(el('span', 'chip', interest)));
    } else {
      chips.append(el('span', 'muted', '—'));
    }
    interestCell.append(chips);

    const joinedCell = el('td', 'mono', formatDate(user.createdAt));

    const actionCell = el('td');
    const actions = el('div', 'cell-actions');

    const lookup = el('button', 'btn btn--ghost btn--sm', 'Posts');
    lookup.type = 'button';
    lookup.title = 'Inspect this user with the $lookup pipeline';
    lookup.addEventListener('click', () => {
      $('#lookupUserId').value = user.id;
      setView('aggregations');
      runLookup();
    });

    const edit = el('button', 'btn btn--ghost btn--sm', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => openUserModal(user));

    const del = el('button', 'btn btn--danger btn--sm', 'Delete');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete ${user.name}?`)) return;
      try {
        await api(`/users/${user.id}`, { method: 'DELETE' });
        toast('User deleted');
        await loadUsers();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    actions.append(lookup, edit, del);
    actionCell.append(actions);

    tr.append(userCell, roleCell, interestCell, joinedCell, actionCell);
    tbody.append(tr);
  });

  updatePager('users', data);
}

async function loadAllNotes() {
  const data = await api(`/notes?page=${state.pages.allnotes}&limit=${PAGE_SIZE}`);
  const tbody = $('#allNotesRows');
  tbody.innerHTML = '';
  $('#allNotesCount').textContent = `${data.total} note${data.total === 1 ? '' : 's'} across all users`;

  if (!data.data.length) {
    emptyRow(tbody, 4, 'No notes have been created yet.');
  }

  data.data.forEach((note) => {
    const tr = el('tr');
    tr.append(
      el('td', null, note.title),
      el('td', 'truncate', note.content),
      el('td', 'mono', note.userId),
      el('td', 'mono', formatDate(note.createdAt))
    );
    tbody.append(tr);
  });

  updatePager('allnotes', data);
}

/* ---------------- Aggregations ---------------- */

async function runInterests() {
  const container = $('#interestsResult');
  try {
    const data = await api('/aggregations/group-by-interests');
    container.innerHTML = '';

    if (!data.data.length) {
      emptyState(container, 'No interests recorded', 'Add interests to a user profile and run again.');
    } else {
      const grid = el('div', 'agg-grid');
      data.data.forEach((group) => {
        const card = el('div', 'agg-card');
        const head = el('div', 'agg-card__head');
        head.append(el('strong', null, group.interest), el('span', 'badge badge--primary', String(group.count)));
        card.append(head);

        const list = el('ul', 'agg-list');
        group.users.forEach((user) => {
          const li = el('li');
          li.append(el('span', 'avatar avatar--sm', initials(user.name)));
          const meta = el('div', 'cell-user__meta');
          meta.append(el('strong', null, user.name), el('small', null, user.email));
          li.append(meta);
          list.append(li);
        });
        card.append(list);
        grid.append(card);
      });
      container.append(grid);
    }

    $('#interestsRaw').textContent = JSON.stringify(data, null, 2);
    $('#interestsRawWrap').hidden = false;
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function runLookup() {
  const userId = $('#lookupUserId').value.trim();
  const container = $('#lookupResult');
  if (!userId) {
    toast('Enter a user id first', 'error');
    return;
  }

  try {
    const data = await api(`/aggregations/user-posts/${userId}`);
    container.innerHTML = '';

    const header = el('div', 'cell-user');
    header.append(el('span', 'avatar', initials(data.name)));
    const meta = el('div', 'cell-user__meta');
    meta.append(el('strong', null, data.name), el('small', null, `${data.email} · ${data.posts.length} post(s)`));
    header.append(meta);
    container.append(header);

    if (!data.posts.length) {
      const wrap = el('div', 'grid');
      emptyState(wrap, 'No posts found', 'This user has not published anything yet.');
      container.append(wrap);
    } else {
      const grid = el('div', 'grid');
      grid.style.marginTop = '14px';
      data.posts.forEach((post) => {
        const card = el('article', 'item');
        card.append(el('h3', 'item__title', post.title), el('p', 'item__body', post.body));
        const foot = el('div', 'item__foot');
        foot.append(el('span', 'item__meta', formatDate(post.createdAt)));
        card.append(foot);
        grid.append(card);
      });
      container.append(grid);
    }

    $('#lookupRaw').textContent = JSON.stringify(data, null, 2);
    $('#lookupRawWrap').hidden = false;
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------------- Modal ---------------- */

function openModal(title, formId) {
  const target = $(`#${formId}`);
  $('#modalTitle').textContent = title;
  $$('.form--modal').forEach((form) => { form.hidden = form !== target; });
  $('#modal').hidden = false;
  const firstInput = $('.input', target);
  if (firstInput) setTimeout(() => firstInput.focus(), 40);
}

function closeModal() {
  $('#modal').hidden = true;
  $$('.form--modal').forEach((form) => form.reset());
}

function openNoteModal(note) {
  const form = $('#noteForm');
  form.reset();
  const fields = form.elements;
  fields.id.value = note ? note.id : '';
  if (note) {
    fields.title.value = note.title;
    fields.content.value = note.content;
  }
  openModal(note ? 'Edit note' : 'New note', 'noteForm');
}

function openUserModal(user) {
  const form = $('#userForm');
  form.reset();
  const fields = form.elements;
  fields.id.value = user ? user.id : '';
  if (user) {
    fields.name.value = user.name;
    fields.email.value = user.email;
    fields.role.value = user.role;
    fields.interests.value = (user.interests || []).join(', ');
  }
  openModal(user ? 'Edit user' : 'Add user', 'userForm');
}

/* ---------------- Theme ---------------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('theme', theme);
}

/* ---------------- Events ---------------- */

$$('[data-auth-tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('[data-auth-tab]').forEach((t) => t.classList.toggle('is-active', t === tab));
    const isLogin = tab.dataset.authTab === 'login';
    $('#loginForm').hidden = !isLogin;
    $('#registerForm').hidden = isLogin;
  });
});

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }),
    });
    e.target.reset();
    setSession(data.token, data.user);
    toast(`Welcome back, ${data.user.name}`);
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const data = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        email: fd.get('email'),
        password: fd.get('password'),
        interests: parseInterests(fd.get('interests')),
      }),
    });
    e.target.reset();
    setSession(data.token, data.user);
    toast('Account created');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#logoutBtn').addEventListener('click', () => {
  setSession('', null);
  state.pages = { notes: 1, posts: 1, users: 1, allnotes: 1 };
  state.view = 'notes';
});

$$('.nav__item').forEach((btn) => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

$('#themeToggle').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

$('#newNoteBtn').addEventListener('click', () => openNoteModal(null));
$('#newPostBtn').addEventListener('click', () => openModal('New post', 'postForm'));
$('#newUserBtn').addEventListener('click', () => openUserModal(null));

$$('[data-close-modal]').forEach((node) => node.addEventListener('click', closeModal));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
});

$('#noteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const id = fd.get('id');
  const body = { title: fd.get('title'), content: fd.get('content') };
  try {
    if (id) await api(`/notes/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/notes', { method: 'POST', body: JSON.stringify(body) });
    closeModal();
    toast(id ? 'Note updated' : 'Note created');
    await loadNotes();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#postForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('/posts', {
      method: 'POST',
      body: JSON.stringify({ title: fd.get('title'), body: fd.get('body') }),
    });
    closeModal();
    toast('Post published');
    await loadPosts();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#userForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const id = fd.get('id');
  const password = fd.get('password');
  const payload = {
    name: fd.get('name'),
    email: fd.get('email'),
    role: fd.get('role'),
    interests: parseInterests(fd.get('interests')),
  };
  if (password) payload.password = password;

  try {
    if (id) {
      await api(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      if (!password) throw new Error('Password is required when creating a user');
      await api('/users', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeModal();
    toast(id ? 'User updated' : 'User created');
    await loadUsers();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#loadInterestsBtn').addEventListener('click', runInterests);
$('#lookupBtn').addEventListener('click', runLookup);

/* ---------------- Boot ---------------- */

applyTheme(localStorage.getItem('theme') || 'light');
wirePagers();
renderSession();
