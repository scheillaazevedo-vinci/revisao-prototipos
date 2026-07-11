const SUPABASE_URL = 'https://xatulphpgychgztxsukw.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhdHVscGhwZ3ljaGd6dHhzdWt3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3ODM3NzcsImV4cCI6MjA5OTM1OTc3N30.2Baagi4c5FuwojTls-M6PC0xozxtvHURbQ9ZiAWSVRw';
  const FIGMA_CLIENT_ID = 'pYHM3T2GqInUirsFcjG9y5';

  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const state = {
    screen: 'loading',
    session: null,
    currentProjectId: null,
    currentPresentationId: null,
    projects: [],
    presentations: [],
    presentation: null,
    comments: [],
    commentsVisible: false,
    commentMode: false,
    selectedCommentId: null,
    filterClienteOnly: false,
    filterUnresolvedOnly: false,
    currentNodeId: null,
    realtimeChannel: null,
    globalChannel: null,
    notifications: [],
    notifDropdownOpen: false
  };

  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
  function showToast(msg){
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }
  function isEquipa(){ return !!state.session; }

  // ---------- Arranque ----------
  async function boot(){
    const { data } = await sb.auth.getSession();
    state.session = data.session;
    sb.auth.onAuthStateChange((_event, session) => { state.session = session; });

    await pingHeartbeatAndMaybeWarn();

    if(state.session){ subscribeGlobalNotifications(); }

    const params = new URLSearchParams(window.location.search);
    const apresentacaoId = params.get('apresentacao');

    if(apresentacaoId){
      await openReview(apresentacaoId);
      return;
    }
    if(!state.session){
      state.screen = 'login';
    }else{
      state.screen = 'projects';
      await loadProjects();
    }
    render();
  }

  async function pingHeartbeatAndMaybeWarn(){
    try{
      const { data: prev } = await sb.from('app_heartbeat').select('last_ping').eq('id', 1).single();
      const previousPing = prev?.last_ping ? new Date(prev.last_ping) : null;
      await sb.from('app_heartbeat').update({ last_ping: new Date().toISOString() }).eq('id', 1);
      if(state.session && previousPing){
        const daysSince = (Date.now() - previousPing.getTime()) / 86400000;
        if(daysSince > 4){
          document.getElementById('inactivity-banner').classList.remove('hidden');
        }
      }
    }catch(e){ /* tabela ainda não criada, ou sem permissão; ignora silenciosamente */ }
  }
  function dismissBanner(){
    document.getElementById('inactivity-banner').classList.add('hidden');
  }

  // ---------- Autenticação ----------
  async function loginWithGithub(){
    await sb.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: window.location.origin + window.location.pathname }
    });
  }
  async function logout(){
    await sb.auth.signOut();
    state.session = null;
    if(state.globalChannel){ sb.removeChannel(state.globalChannel); state.globalChannel = null; }
    state.notifications = [];
    state.screen = 'login';
    render();
  }

  // ---------- Notificações ----------
  function subscribeGlobalNotifications(){
    if(state.globalChannel){ sb.removeChannel(state.globalChannel); }
    state.globalChannel = sb.channel('global-client-comments')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter: 'author=eq.cliente' },
        () => { loadNotifications(); })
      .subscribe();
    loadNotifications();
  }
  async function loadNotifications(){
    const { data, error } = await sb.from('comments')
      .select('id, presentation_id, text, created_at, seen_by_team, presentations(name, projects(name))')
      .eq('author', 'cliente')
      .order('created_at', { ascending: false })
      .limit(30);
    if(error){ console.error('Erro ao carregar notificações:', error); return; }
    state.notifications = (data || []).map(row => ({
      id: row.id,
      presentationId: row.presentation_id,
      presentationName: row.presentations?.name || 'Apresentação',
      projectName: row.presentations?.projects?.name || '',
      text: row.text,
      createdAt: row.created_at,
      seen: row.seen_by_team
    }));
    updateNotifBell();
  }
  function updateNotifBell(){
    const badge = document.getElementById('notif-badge');
    if(!badge) return;
    const unseenCount = state.notifications.filter(n => !n.seen).length;
    badge.textContent = unseenCount;
    badge.classList.toggle('hidden', unseenCount === 0);
    renderNotifDropdown();
  }
  function toggleNotifDropdown(){
    state.notifDropdownOpen = !state.notifDropdownOpen;
    renderNotifDropdown();
  }
  function renderNotifDropdown(){
    const dd = document.getElementById('notif-dropdown');
    if(!dd) return;
    dd.classList.toggle('hidden', !state.notifDropdownOpen);
    if(!state.notifDropdownOpen) return;
    if(state.notifications.length === 0){
      dd.innerHTML = '<div class="notif-empty">Ainda não há comentários de clientes</div>';
      return;
    }
    dd.innerHTML = state.notifications.map((n, i) => {
      const time = new Date(n.createdAt).toLocaleString('pt-PT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `
      <div class="notif-item${n.seen ? '' : ' unseen'}" onclick="openNotification(${i})">
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px;">
          ${!n.seen ? '<span class="notif-dot"></span>' : ''}
          <span style="font-size:11px; color:var(--ink-mute);">${esc(n.projectName)}</span>
        </div>
        <div style="font-weight:700; font-size:13.5px; margin-bottom:5px; color:${n.seen ? 'var(--ink-soft)' : 'var(--ink)'};">${esc(n.presentationName)}</div>
        <div style="color:var(--ink-soft); margin-bottom:4px;">${esc(n.text.slice(0, 60))}${n.text.length > 60 ? '…' : ''}</div>
        <div style="font-size:11px; color:var(--ink-mute);">${time}</div>
      </div>`;
    }).join('');
  }
  async function openNotification(i){
    const n = state.notifications[i];
    state.notifDropdownOpen = false;
    await openReview(n.presentationId);
  }

  // ---------- Projetos ----------
  async function loadProjects(){
    const { data, error } = await sb.from('projects').select('*, presentations(id, status)').order('created_at');
    if(error){ showToast('Erro a carregar projetos'); return; }
    state.projects = data || [];
  }
  async function openProject(id){
    state.currentProjectId = id;
    state.screen = 'detail';
    const { data, error } = await sb.from('presentations').select('*').eq('project_id', id).order('created_at');
    if(error){ showToast('Erro a carregar apresentações'); return; }
    state.presentations = data || [];
    render();
  }
  function currentProject(){ return state.projects.find(p => p.id === state.currentProjectId); }

  const GRADIENT_OPTIONS = [
    ['#2f6fed', '#7fa8f5'],
    ['#7c4dff', '#b39dff'],
    ['#0f9e75', '#6fd9b2'],
    ['#d85a30', '#f2a583'],
    ['#a20067', '#e0699f'],
    ['#b3860b', '#f0c96a']
  ];
  function gradientCss(colorValue){
    const parts = String(colorValue || '').split(',').map(s => s.trim()).filter(Boolean);
    if(parts.length >= 2) return `linear-gradient(135deg, ${parts[0]}, ${parts[1]})`;
    if(parts.length === 1) return `linear-gradient(135deg, ${parts[0]}, ${parts[0]})`;
    return `linear-gradient(135deg, ${GRADIENT_OPTIONS[0][0]}, ${GRADIENT_OPTIONS[0][1]})`;
  }
  function colorSwatches(selected){
    return GRADIENT_OPTIONS.map(pair => {
      const value = pair.join(',');
      const isSel = value === selected;
      return `<div class="swatch${isSel ? ' selected' : ''}" data-swatch="${value}" style="background:linear-gradient(135deg, ${pair[0]}, ${pair[1]});" onclick="selectSwatch('${value}')"></div>`;
    }).join('');
  }
  function selectSwatch(value){
    document.getElementById('project-color-input').value = value;
    document.querySelectorAll('[data-swatch]').forEach(el => { el.classList.toggle('selected', el.getAttribute('data-swatch') === value); });
  }
  function openProjectModal(id){
    const project = id ? state.projects.find(p => p.id === id) : null;
    const name = project ? project.name : '';
    const color = project ? project.color : GRADIENT_OPTIONS[0].join(',');
    const deleteBtn = project ? `<button class="btn-ghost" style="color:var(--danger);" onclick="deleteProject('${project.id}')">Eliminar projeto</button>` : '';
    document.getElementById('modal-root').innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
        <div class="modal-box">
          <h2>${project ? 'Configurar projeto' : 'Criar projeto'}</h2>
          <label for="project-name-input">Nome do projeto</label>
          <input type="text" id="project-name-input" value="${esc(name)}" placeholder="Nome do cliente">
          <span class="swatch-label">Cor do projecto</span>
          <input type="hidden" id="project-color-input" value="${color}">
          <div class="swatch-row" style="margin-bottom:20px;">${colorSwatches(color)}</div>
          <div class="modal-actions">${deleteBtn}
            <button class="btn-ghost" onclick="closeModal()">Cancelar</button>
            <button class="btn" onclick="submitProjectModal(${project ? `'${project.id}'` : 'null'})">${project ? 'Guardar' : 'Criar'}</button>
          </div>
        </div>
      </div>`;
  }
  function closeModal(){ document.getElementById('modal-root').innerHTML = ''; }
  async function submitProjectModal(id){
    const name = document.getElementById('project-name-input').value.trim();
    const color = document.getElementById('project-color-input').value;
    if(!name){ showToast('Dê um nome ao projeto antes de continuar'); return; }
    if(id){
      const { error } = await sb.from('projects').update({ name, color }).eq('id', id);
      if(error){ showToast('Sem permissão ou erro ao guardar'); return; }
      showToast('Projeto actualizado');
    }else{
      const { error } = await sb.from('projects').insert({ name, color });
      if(error){ showToast('Sem permissão ou erro ao criar'); return; }
      showToast('Projeto criado');
    }
    closeModal();
    await loadProjects();
    render();
  }
  async function deleteProject(id){
    if(!confirm('Eliminar este projeto e todas as suas apresentações e comentários?')) return;
    const { error } = await sb.from('projects').delete().eq('id', id);
    if(error){ showToast('Erro ao eliminar'); return; }
    closeModal();
    state.screen = 'projects';
    await loadProjects();
    render();
    showToast('Projeto eliminado');
  }

  // ---------- Apresentações ----------
  function copyLink(id){
    const base = window.location.origin + window.location.pathname;
    const link = `${base}?apresentacao=${id}`;
    navigator.clipboard?.writeText(link);
    showToast('Link copiado, pronto a enviar ao cliente');
  }
  function openCreateModal(){
    document.getElementById('modal-root').innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
        <div class="modal-box">
          <h2>Criar apresentação</h2>
          <label for="new-name">Nome da apresentação</label>
          <input type="text" id="new-name" placeholder="Homepage, versão 3">
          <label for="new-link">Link de apresentação do Figma</label>
          <input type="text" id="new-link" placeholder="https://www.figma.com/proto/...">
          <div class="modal-actions">
            <button class="btn-ghost" onclick="closeModal()">Cancelar</button>
            <button class="btn" onclick="submitCreatePresentation()">Criar</button>
          </div>
        </div>
      </div>`;
  }
  async function submitCreatePresentation(){
    const name = document.getElementById('new-name').value.trim();
    const link = document.getElementById('new-link').value.trim();
    if(!name || !link){ showToast('Preencha o nome e o link antes de criar'); return; }
    const { error } = await sb.from('presentations').insert({ project_id: state.currentProjectId, name, figma_link: link, status: 'ativo' });
    if(error){ showToast('Sem permissão ou erro ao criar'); return; }
    closeModal();
    await openProject(state.currentProjectId);
    showToast('Apresentação criada');
  }
  async function deletePresentation(id){
    if(!confirm('Eliminar esta apresentação e todos os seus comentários?')) return;
    const { error } = await sb.from('presentations').delete().eq('id', id);
    if(error){ showToast('Erro ao eliminar'); return; }
    closeModal();
    await openProject(state.currentProjectId);
  }

  // ---------- Revisão ----------
  function toEmbedUrl(rawLink){
    try{
      const u = new URL(rawLink);
      u.hostname = 'embed.figma.com';
      u.searchParams.set('client-id', FIGMA_CLIENT_ID);
      u.searchParams.set('embed-host', 'revisao-prototipos');
      u.searchParams.set('hide-ui', '1');
      return u.toString();
    }catch(e){ return null; }
  }
  async function openReview(presentationId){
    state.currentPresentationId = presentationId;
    state.commentsVisible = false;
    state.commentMode = false;
    state.selectedCommentId = null;
    state.filterClienteOnly = false;
    state.filterUnresolvedOnly = false;
    state.currentNodeId = null;
    const { data: pres, error } = await sb.from('presentations').select('*, projects(name)').eq('id', presentationId).single();
    if(error || !pres){ state.screen = 'not-found'; render(); return; }
    state.presentation = pres;
    state.screen = 'review';
    await loadComments();
    subscribeComments();
    if(isEquipa()){
      await sb.from('comments').update({ seen_by_team: true })
        .eq('presentation_id', presentationId).eq('author', 'cliente').eq('seen_by_team', false);
      await loadNotifications();
    }
    render();
  }
  async function loadComments(){
    const { data, error } = await sb.from('comments').select('*').eq('presentation_id', state.currentPresentationId).order('created_at');
    if(!error) state.comments = data || [];
  }
  function subscribeComments(){
    if(state.realtimeChannel){ sb.removeChannel(state.realtimeChannel); }
    state.realtimeChannel = sb.channel('comments-' + state.currentPresentationId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `presentation_id=eq.${state.currentPresentationId}` },
        async () => { await loadComments(); updateReviewDynamic(); })
      .subscribe();
  }
  window.addEventListener('message', (event) => {
    if(event.origin !== 'https://www.figma.com') return;
    const data = event.data || {};
    if(data.type === 'PRESENTED_NODE_CHANGED' && data.data){
      state.currentNodeId = data.data.presentedNodeId || null;
      closeAnyPopover();
      updateReviewDynamic();
    }
  });
  function toggleCommentMode(){
    state.commentMode = !state.commentMode;
    if(state.commentMode){ state.commentsVisible = true; }
    updateReviewDynamic();
  }
  function closeCommentPanel(){
    state.commentsVisible = false;
    state.commentMode = false;
    updateReviewDynamic();
  }
  function selectComment(id){
    if(!state.commentsVisible){ state.commentsVisible = true; }
    state.selectedCommentId = id;
    updateReviewDynamic();
    const el = document.getElementById('comment-' + id);
    if(el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function closeAnyPopover(){ const el = document.querySelector('.popover'); if(el) el.remove(); }

  function placeComment(ev){
    if(!state.commentMode) return;
    closeAnyPopover();
    const rect = ev.currentTarget.getBoundingClientRect();
    const xPct = ((ev.clientX - rect.left) / rect.width) * 100;
    const yPct = ((ev.clientY - rect.top) / rect.height) * 100;
    const pxX = ev.clientX - rect.left;
    const pxY = ev.clientY - rect.top;
    const layer = document.getElementById('comment-layer');
    const pop = document.createElement('div');
    pop.className = 'popover';
    pop.style.left = Math.min(pxX, layer.clientWidth - 260) + 'px';
    pop.style.top = Math.min(pxY, layer.clientHeight - 140) + 'px';
    pop.innerHTML = `<textarea placeholder="Escreva o seu comentário..."></textarea><div class="row"><button class="cancel">Cancelar</button><button class="save">Guardar</button></div>`;
    pop.addEventListener('click', e => e.stopPropagation());
    layer.appendChild(pop);
    const ta = pop.querySelector('textarea'); ta.focus();
    pop.querySelector('.cancel').onclick = () => pop.remove();
    pop.querySelector('.save').onclick = async () => {
      const text = ta.value.trim();
      if(!text){ pop.remove(); return; }
      const author = isEquipa() ? 'equipa' : 'cliente';
      const { error } = await sb.from('comments').insert({
        presentation_id: state.currentPresentationId, author, text, x: xPct, y: yPct, screen_name: state.currentNodeId
      });
      pop.remove();
      if(error){ showToast('Sem permissão para comentar'); return; }
      await loadComments();
      updateReviewDynamic();
    };
  }
  async function toggleResolved(id){
    const c = state.comments.find(x => x.id === id);
    const { error } = await sb.from('comments').update({ resolved: !c.resolved }).eq('id', id);
    if(error){ showToast('Sem permissão'); return; }
    await loadComments();
    updateReviewDynamic();
  }
  async function deleteComment(id){
    const { error } = await sb.from('comments').delete().eq('id', id);
    if(error){ showToast('Sem permissão para apagar este comentário'); return; }
    await loadComments();
    updateReviewDynamic();
  }

  // ---------- Render ----------
  function render(){
    const backBtn = document.getElementById('back-btn');
    const crumb = document.getElementById('crumb');
    const topRight = document.getElementById('topbar-actions');
    const topbarEl = document.querySelector('.topbar');
    const pageEl = document.getElementById('page');
    backBtn.classList.add('hidden');
    backBtn.onclick = null;
    topRight.innerHTML = '';

    if(state.screen === 'login'){
      topbarEl.style.display = 'none';
      pageEl.className = '';
      renderLogin();
      return;
    }
    topbarEl.style.display = 'flex';
    document.getElementById('notif-wrap').classList.toggle('hidden', !isEquipa() || state.screen === 'review');

    if(state.screen === 'not-found'){
      pageEl.className = 'page';
      crumb.textContent = 'Revisão de protótipos';
      renderNotFound();
      return;
    }

    if(state.screen === 'projects'){
      pageEl.className = 'page';
      crumb.textContent = 'Revisão de protótipos';
      topRight.innerHTML = `<button class="icon-btn" title="Terminar sessão" onclick="logout()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg></button>`;
      renderProjects();
    }
    if(state.screen === 'detail'){
      pageEl.className = 'page';
      const project = currentProject();
      backBtn.classList.remove('hidden');
      backBtn.onclick = () => { state.screen = 'projects'; render(); };
      crumb.innerHTML = 'Revisão de protótipos &rsaquo; <b>' + esc(project ? project.name : '') + '</b>';
      topRight.innerHTML = `<button class="icon-btn" title="Terminar sessão" onclick="logout()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg></button>`;
      renderDetail();
    }
    if(state.screen === 'review'){
      const p = state.presentation;
      const blocked = p.status === 'inativo' && !isEquipa();
      pageEl.className = blocked ? 'page' : 'page-full';
      if(isEquipa()){
        backBtn.classList.remove('hidden');
        backBtn.onclick = () => { state.screen = 'detail'; render(); };
      }
      crumb.innerHTML = 'Revisão de protótipos &rsaquo; ' + esc(p?.projects?.name || '') + ' &rsaquo; <b>' + esc(p?.name || '') + '</b>';
      if(!blocked){
        topRight.innerHTML = `
          <button class="comment-toggle-btn" id="toggle-btn" onclick="toggleCommentMode()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            <span id="toggle-label">Fazer comentário</span>
          </button>`;
      }
      renderReview();
    }
  }

  function renderLogin(){
    document.getElementById('page').innerHTML = `
      <div class="split">
        <div class="brand-side">
          <div class="brand-mark">
            <img src="logo-branco.webp" alt="Logótipo" id="brand-logo">
            <span>Revisão de protótipos</span>
          </div>
          <div class="brand-copy">
            <h1>Apresente protótipos ao cliente, sem abrir as portas do Figma.</h1>
            <p>Partilhe apenas o que o cliente precisa de ver, e receba o feedback dele organizado num só lugar, sem trocas de ficheiros por email.</p>
          </div>
          <div class="brand-footer">Ferramenta interna · Equipa de Design</div>
        </div>
        <div class="form-side">
          <div class="login-card">
            <h2>Painel da equipa</h2>
            <p>Inicie sessão com a sua conta GitHub da empresa para gerir projectos e apresentações.</p>
            <button class="btn-github" onclick="loginWithGithub()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.75 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.83 1.18 3.09 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.08.78 2.17 0 1.57-.01 2.83-.01 3.22 0 .3.2.66.79.55A10.52 10.52 0 0 0 23.5 12c0-6.27-5.23-11.5-11.5-11.5Z"/></svg>
              Iniciar sessão com o GitHub
            </button>
            <div class="login-foot">Precisa de acesso? Contacte a equipa de design.</div>
          </div>
        </div>
      </div>`;
    const logo = document.getElementById('brand-logo');
    logo.addEventListener('load', function(){
      logo.style.width = (logo.naturalWidth * 0.6) + 'px';
      logo.style.height = 'auto';
    });
  }
  function renderNotFound(){
    document.getElementById('page').innerHTML = `
      <div class="unavailable">
        <div class="icon">&#33;</div>
        <h2 style="font-size:16px;font-weight:600;margin-bottom:8px;">Esta apresentação não foi encontrada</h2>
        <p style="font-size:13.5px;color:var(--ink-soft);">Verifique o link recebido ou contacte a equipa responsável.</p>
      </div>`;
  }

  function greetingName(){
    const meta = state.session?.user?.user_metadata || {};
    return meta.full_name || meta.name || meta.user_name || state.session?.user?.email?.split('@')[0] || 'equipa';
  }
  function renderProjects(){
    const totalProjects = state.projects.length;
    const totalActive = state.projects.reduce((sum, p) => sum + (p.presentations || []).filter(pr => pr.status === 'ativo').length, 0);
    let cards = state.projects.map(p => {
      const count = (p.presentations || []).length;
      const label = count === 1 ? '1 apresentação' : `${count} apresentações`;
      return `
      <div class="project-card" onclick="openProject('${p.id}')">
        <div class="card-strip" style="background:${gradientCss(p.color)};"></div>
        <div class="card-body">
          <div class="name">${esc(p.name)}</div>
          <div class="card-meta-count"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/></svg>${label}</div>
          <div class="card-meta-date"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>${new Date(p.created_at).toLocaleDateString('pt-PT')}</div>
        </div>
      </div>`;
    }).join('');
    cards += `<div class="project-card new" onclick="openProjectModal(null)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><span>Novo projeto</span></div>`;
    document.getElementById('page').innerHTML = `
      <div class="hero">
        <h1>Olá, ${esc(greetingName())}</h1>
        <p><b>${totalProjects} projeto${totalProjects === 1 ? '' : 's'}</b> · ${totalActive} apresentaç${totalActive === 1 ? 'ão activa' : 'ões activas'}</p>
      </div>
      <div class="card-grid">${cards}</div>`;
  }

  function renderDetail(){
    const project = currentProject();
    const rows = state.presentations.map(pr => {
      const statusClass = pr.status === 'ativo' ? 'status-active' : 'status-inactive';
      const rowClass = pr.status === 'inativo' ? 'row-inactive' : '';
      return `<tr class="${rowClass}">
        <td>${esc(pr.name)}</td>
        <td>${new Date(pr.created_at).toLocaleDateString('pt-PT')}</td>
        <td><span class="status-pill ${statusClass}">${pr.status}</span></td>
        <td><div class="row-actions">
          <button class="icon-btn on-light" title="Copiar link de apresentação" onclick="copyLink('${pr.id}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a3.5 3.5 0 0 0 5 0l4-4a3.5 3.5 0 0 0-5-5l-1.5 1.5"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-4 4a3.5 3.5 0 0 0 5 5l1.5-1.5"/></svg>
          </button>
          <button class="icon-btn on-light" title="Ver protótipo" onclick="openReview('${pr.id}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="icon-btn on-light" title="Configurar apresentação" onclick="openPresentationModal('${pr.id}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        </div></td>
      </tr>`;
    }).join('');
    document.getElementById('page').innerHTML = `
      <div class="page-header"><h1>${esc(project ? project.name : '')}</h1>
        <div style="display:flex;gap:8px;">
          <button class="btn-ghost" onclick="openProjectModal('${project.id}')">Configurar projeto</button>
          <button class="btn" onclick="openCreateModal()">+ Criar apresentação</button>
        </div>
      </div>
      <table><thead><tr><th>Nome</th><th>Data de criação</th><th>Estado</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="color:var(--ink-soft);">Ainda não existem apresentações.</td></tr>'}</tbody></table>`;
  }

  function openPresentationModal(id){
    const pr = state.presentations.find(p => p.id === id);
    document.getElementById('modal-root').innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
        <div class="modal-box">
          <h2>Configurar apresentação</h2>
          <label for="pres-name-input">Nome da apresentação</label>
          <input type="text" id="pres-name-input" value="${esc(pr.name)}">
          <div class="status-row">
            <div>
              <div class="label">Apresentação activa</div>
              <div class="hint">Se desactivar, o cliente vê uma mensagem de indisponibilidade.</div>
            </div>
            <label class="switch">
              <input type="checkbox" id="pres-active-input" ${pr.status === 'ativo' ? 'checked' : ''}>
              <span class="track"></span>
            </label>
          </div>
          <div class="danger-zone">
            <button class="btn-danger-ghost" onclick="deletePresentation('${pr.id}')">Remover apresentação</button>
          </div>
          <div class="modal-actions">
            <button class="btn-ghost" onclick="closeModal()">Cancelar</button>
            <button class="btn" onclick="submitPresentationModal('${pr.id}')">Guardar</button>
          </div>
        </div>
      </div>`;
  }
  async function submitPresentationModal(id){
    const name = document.getElementById('pres-name-input').value.trim();
    const active = document.getElementById('pres-active-input').checked;
    if(!name){ showToast('Dê um nome à apresentação antes de continuar'); return; }
    const { error } = await sb.from('presentations').update({ name, status: active ? 'ativo' : 'inativo' }).eq('id', id);
    if(error){ showToast('Sem permissão ou erro ao guardar'); return; }
    closeModal();
    await openProject(state.currentProjectId);
    showToast('Apresentação actualizada');
  }

  function renderReview(){
    const p = state.presentation;
    if(p.status === 'inativo' && !isEquipa()){
      document.getElementById('page').innerHTML = `
        <div class="unavailable">
          <div class="icon">&#33;</div>
          <h2 style="font-size:16px;font-weight:600;margin-bottom:8px;">Esta apresentação está inactiva</h2>
          <p style="font-size:13.5px;color:var(--ink-soft);">Para activar, contacte a equipa de Design.</p>
        </div>`;
      return;
    }
    const existingFrame = document.getElementById('proto-frame');
    const needsFullRender = !existingFrame || existingFrame.dataset.presentationId !== state.currentPresentationId;
    if(needsFullRender){
      renderReviewSkeleton();
    }
    updateReviewDynamic();
  }

  function renderReviewSkeleton(){
    const p = state.presentation;
    const embedUrl = toEmbedUrl(p.figma_link);
    document.getElementById('page').innerHTML = `
      <div class="stage">
        <div class="proto-wrap">
          <iframe id="proto-frame" credentialless data-presentation-id="${state.currentPresentationId}" src="${embedUrl || ''}" allowfullscreen></iframe>
          <div id="comment-layer" class="comment-layer" onclick="placeComment(event)"></div>
        </div>
        <div class="comments-panel" id="comments-panel">
          <div class="comments-panel-inner">
            <div class="comments-panel-header">
              <span>Comentários</span>
              <button class="icon-btn on-light" title="Fechar comentários" onclick="closeCommentPanel()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div class="filter-row">
              <button class="filter-chip" id="filter-cliente-btn" onclick="toggleFilterCliente()">Só do cliente</button>
              <label class="filter-switch-row">
                Por resolver
                <label class="switch">
                  <input type="checkbox" id="filter-unresolved-input" onchange="toggleFilterUnresolved()">
                  <span class="track"></span>
                </label>
              </label>
            </div>
            <div id="comments-list"></div>
          </div>
        </div>
      </div>`;
  }

  function toggleFilterCliente(){
    state.filterClienteOnly = !state.filterClienteOnly;
    updateReviewDynamic();
  }
  function toggleFilterUnresolved(){
    state.filterUnresolvedOnly = document.getElementById('filter-unresolved-input').checked;
    updateReviewDynamic();
  }

  function updateReviewDynamic(){
    const indexMap = new Map(state.comments.map((c, i) => [c.id, i + 1]));

    const nodeList = state.comments.filter(c => (c.screen_name || null) === (state.currentNodeId || null) && !c.resolved);
    const pinsHtml = nodeList.map(c => `<div class="pin" style="left:${c.x}%; top:${c.y}%;" onclick="event.stopPropagation(); selectComment('${c.id}')"><span>${indexMap.get(c.id)}</span></div>`).join('');
    const layer = document.getElementById('comment-layer');
    layer.innerHTML = pinsHtml;
    layer.classList.toggle('commenting', state.commentMode);

    let panelList = state.comments.slice();
    if(state.filterClienteOnly) panelList = panelList.filter(c => c.author === 'cliente');
    if(state.filterUnresolvedOnly) panelList = panelList.filter(c => !c.resolved);

    const filterBtn = document.getElementById('filter-cliente-btn');
    if(filterBtn) filterBtn.classList.toggle('active', state.filterClienteOnly);

    const commentsHtml = panelList.map(c => {
      const canDelete = (c.author === 'equipa' && isEquipa()) || (c.author === 'cliente' && !isEquipa());
      const resolveBtn = isEquipa() ? `<button class="mini-btn" title="Marcar como resolvido" onclick="toggleResolved('${c.id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></button>` : '';
      const isSelected = state.selectedCommentId === c.id;
      const authorLabel = c.author === 'cliente' ? 'Cliente' : 'Equipa';
      const time = new Date(c.created_at).toLocaleString('pt-PT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `<div class="comment${c.resolved ? ' resolved' : ''}${isSelected ? ' selected' : ''}" id="comment-${c.id}">
        <div class="comment-meta-line">
          <span class="comment-number">#${indexMap.get(c.id)}</span>
          <span class="comment-author">${authorLabel}</span>
          <span class="comment-dot"></span>
          <span class="comment-time">${time}</span>
          ${c.resolved ? '<span class="resolved-tag">Resolvido</span>' : ''}
          <span class="comment-actions">${resolveBtn}
            <button class="mini-btn" title="Apagar" ${canDelete ? '' : 'disabled'} onclick="deleteComment('${c.id}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/></svg></button>
          </span>
        </div>
        <p>${esc(c.text)}</p>
      </div>`;
    }).join('') || '<p style="font-size:13px;color:var(--ink-soft);">Nenhum comentário encontrado.</p>';
    document.getElementById('comments-list').innerHTML = commentsHtml;

    document.getElementById('comments-panel').classList.toggle('open', state.commentsVisible);

    const toggleBtn = document.getElementById('toggle-btn');
    if(toggleBtn){
      toggleBtn.classList.toggle('active', state.commentMode);
      const label = document.getElementById('toggle-label');
      label.textContent = state.commentMode ? 'Clique no protótipo...' : 'Fazer comentário';
    }
  }

  boot();