(function(){
  'use strict';

  /* ==========================================================
     1. CLASSIFICAÇÕES DISPONÍVEIS
     ========================================================== */
  const TIPOS = ['Casa', 'Casa geminada', 'Apartamento', 'Terreno'];
  // Equivalencias para cadastros gravados com a lista de tipos anterior
  const TIPOS_ANTIGOS = { 'Sobrado': 'Casa', 'Kitnet': 'Apartamento', 'Lote vago': 'Terreno', 'Ponto comercial': 'Casa' };
  const OCUPACOES = ['Proprietário', 'Inquilino', 'Desocupado'];
  const SITUACOES = ['Normal', 'Em acordo', 'Cobrança jurídica', 'Isento'];

  // Situação de adimplência — calculada a partir das parcelas em aberto,
  // exceto quando a ficha do morador marca acordo, jurídico ou isenção.
  const STATUS = {
    adimplente:   { label: 'Adimplente',            classe: 'st-adimplente',   ordem: 0 },
    revisar:      { label: 'Revisar datas', classe: 'st-acordo', ordem: -1 },
    avencer:      { label: 'A vencer', classe: 'st-adimplente', ordem: 0.5 },
    atraso:       { label: 'Atraso recente',        classe: 'st-atraso',       ordem: 1 },
    inadimplente: { label: 'Inadimplente',          classe: 'st-inadimplente', ordem: 2 },
    critico:      { label: 'Inadimplente crítico',  classe: 'st-critico',      ordem: 3 },
    acordo:       { label: 'Em acordo',             classe: 'st-acordo',       ordem: 4 },
    juridico:     { label: 'Cobrança jurídica',     classe: 'st-juridico',     ordem: 5 },
    isento:       { label: 'Isento',                classe: 'st-isento',       ordem: 6 }
  };
  const DIAS_ATRASO_RECENTE = 30;   // até 30 dias -> atraso recente
  const DIAS_CRITICO = 90;          // acima de 90 dias -> crítico

  /* ==========================================================
     2. UTILITÁRIOS
     ========================================================== */
  const moedaBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtBRL = v => moedaBRL.format(Number.isFinite(v) ? v : 0);
  const $ = id => document.getElementById(id);

  // Data de hoje no fuso local (o toISOString puro devolvia o dia errado à noite no Brasil)
  function hojeISO() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  const todayISO = hojeISO(); // Somente para o valor inicial dos campos.
  const novoId = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() :
    Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
  const taxasAtivas = { taxaJuros: 1, taxaMulta: 2 };
  const numeroSeguro = v => Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;
  const dataValida = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) &&
    !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
  function celulaCsv(v) {
    let s = String(v == null ? '' : v);
    if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }


  // "2026-07-24" -> "24/07/2026"
  const fmtData = iso => String(iso || '').split('-').reverse().join('/');

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function semAcento(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // "L 10" / "l-10" -> "L10", para comparar unidades sem depender de espaços
  const normUnidade = u => semAcento(u).toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Deduz a quadra a partir do código da unidade: "L10" -> "L", "M2 101" -> "M"
  function quadraDeUnidade(u) {
    const m = normUnidade(u).match(/^[A-Z]+/);
    return m ? m[0] : '';
  }

  // Ordena unidades de forma natural: L2 vem antes de L10
  function compararUnidade(a, b) {
    const ra = normUnidade(a), rb = normUnidade(b);
    const la = (ra.match(/^[A-Z]+/) || [''])[0], lb = (rb.match(/^[A-Z]+/) || [''])[0];
    if (la !== lb) return la.localeCompare(lb, 'pt-BR');
    const na = parseInt(ra.replace(/^[A-Z]+/, ''), 10) || 0;
    const nb = parseInt(rb.replace(/^[A-Z]+/, ''), 10) || 0;
    if (na !== nb) return na - nb;
    return ra.localeCompare(rb, 'pt-BR');
  }

  function preencherSelect(el, opcoes, rotuloVazio) {
    if (!el) return;
    const atual = el.value;
    el.innerHTML = (rotuloVazio ? `<option value="">${esc(rotuloVazio)}</option>` : '') +
      opcoes.map(o => {
        const valor = typeof o === 'string' ? o : o.valor;
        const rotulo = typeof o === 'string' ? o : o.rotulo;
        return `<option value="${esc(valor)}">${esc(rotulo)}</option>`;
      }).join('');
    if (atual) el.value = atual;
  }

  /* ==========================================================
     3. FIREBASE
     ========================================================== */
  const firebaseConfig = {
    apiKey: "AIzaSyB00pfXLrZxVHFZH2CGGenvyqMm8Uh8Vgk",
    authDomain: "monteverde-f6be6.firebaseapp.com",
    projectId: "monteverde-f6be6",
    storageBucket: "monteverde-f6be6.firebasestorage.app",
    messagingSenderId: "1024392119540",
    appId: "1:1024392119540:web:5367fd3b8ab0837912caa1"
  };
  if (typeof firebase === 'undefined') {
    $('loginErro').textContent = 'Não foi possível conectar. Verifique a internet e tente novamente.';
    $('btnLogin').textContent = 'Tentar novamente';
    $('btnLogin').type = 'button';
    $('btnLogin').addEventListener('click', () => location.reload());
    return;
  }
  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const docRef = db.collection('condominio').doc('dados');

  let moradores = {};
  let moradorAtivoKey = null;
  let saveTimer = null;

  const filtros = { busca: '', quadra: '', tipo: '', status: '', ocupacao: '', agrupar: 'quadra', ordenar: 'unidade' };

  // Quais grupos (quadras) o usuário deixou abertos no celular. Persiste entre
  // re-renderizações da lista para o acordeão não fechar sozinho ao filtrar.
  const gruposAbertos = new Set();
  const ehCelular = () => window.matchMedia('(max-width: 600px)').matches;

  /* ==========================================================
     4. MODELO DE DADOS — migração dos cadastros antigos
     ==========================================================
     Os moradores gravados antes deste incremento só tinham
     nomeExibicao, quadra e parcelas. A função abaixo completa os
     campos novos sem apagar nada do que já existia: o nome e a
     unidade são extraídos do próprio nomeExibicao ("JOSÉ ALDO ·
     UNIDADE L10"), e os demais campos recebem um padrão editável.
  */
  function montarExibicao(m) {
    const nome = (m.nome || '').trim().toUpperCase();
    const uni = (m.unidade || '').trim().toUpperCase();
    return uni ? `${nome} · UNIDADE ${uni}` : nome;
  }

  function normalizarMorador(m) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
    m.parcelas = Array.isArray(m.parcelas) ? m.parcelas.filter(p => p && typeof p === 'object' && !Array.isArray(p)) : [];

    if (typeof m.nome !== 'string' || typeof m.unidade !== 'string') {
      const bruto = String(m.nomeExibicao || '');
      const partes = bruto.split('·');
      if (typeof m.nome !== 'string') m.nome = (partes[0] || bruto).trim();
      if (typeof m.unidade !== 'string') {
        m.unidade = partes[1] ? partes[1].replace(/unidade/i, '').trim() : '';
      }
    }
    m.nome = m.nome.trim();
    m.unidade = m.unidade.trim().toUpperCase();
    m.quadra = String(m.quadra || '').trim().toUpperCase();
    if (!m.quadra && m.unidade) m.quadra = quadraDeUnidade(m.unidade);

    if (TIPOS_ANTIGOS[m.tipo]) m.tipo = TIPOS_ANTIGOS[m.tipo];
    if (TIPOS.indexOf(m.tipo) === -1) m.tipo = 'Casa';
    if (OCUPACOES.indexOf(m.ocupacao) === -1) m.ocupacao = 'Proprietário';
    if (SITUACOES.indexOf(m.situacao) === -1) m.situacao = 'Normal';
    if (typeof m.telefone !== 'string') m.telefone = '';
    if (typeof m.email !== 'string') m.email = '';
    if (typeof m.observacoes !== 'string') m.observacoes = '';
    const dia = parseInt(m.diaVencimento, 10);
    m.diaVencimento = (dia >= 1 && dia <= 31) ? dia : 15;
    const taxa = parseFloat(m.valorTaxa);
    m.valorTaxa = Number.isFinite(taxa) ? Math.max(0, taxa) : 430;

    const ids = new Set();
    m.parcelas.forEach(p => {
      if (!p.id || ids.has(String(p.id))) p.id = novoId();
      p.id = String(p.id);
      ids.add(p.id);
      p.valor = numeroSeguro(p.valor);
      p.venc = typeof p.venc === 'string' ? p.venc : '';
      p.ref = typeof p.ref === 'string' ? p.ref : '';
      p.pago = p.pago === true;
      // Datas de pagamento ausentes no histórico continuam desconhecidas.
    });

    if (!m.nomeExibicao) m.nomeExibicao = montarExibicao(m);
    return m;
  }

  function normalizarTodos() {
    Object.keys(moradores).forEach(k => {
      if (!normalizarMorador(moradores[k])) delete moradores[k];
    });
  }

  /* ==========================================================
     5. CÁLCULO DE JUROS, MULTA E SITUAÇÃO
     ========================================================== */
  function diasEntre(a, b) {
    if (!dataValida(a) || !dataValida(b)) return 0;
    const da = new Date(a + 'T00:00:00Z');
    const db2 = new Date(b + 'T00:00:00Z');
    if (isNaN(da) || isNaN(db2)) return 0;
    return Math.round((db2 - da) / 86400000);
  }

  function calcParcela(p) {
    if (p.pago && p.calculoPago && ['dias','juros','multa','total'].every(k => Number.isFinite(p.calculoPago[k]))) {
      return { ...p.calculoPago };
    }
    if (!dataValida(p.venc) || !dataValida(p.ref)) return { dias: 0, juros: 0, multa: 0, total: p.valor, incompleto: true };
    const taxaJuros = taxasAtivas.taxaJuros;
    const taxaMulta = taxasAtivas.taxaMulta;
    const dias = Math.max(0, diasEntre(p.venc, p.ref));
    const diasPos = Math.max(dias, 0);
    const juros = diasPos > 0 ? ((p.valor * (taxaJuros / 100)) / 30) * diasPos : 0;
    const multa = diasPos > 0 ? p.valor * (taxaMulta / 100) : 0;
    const total = p.valor + juros + multa;
    return { dias, juros, multa, total };
  }

  // Consolida a situação financeira de um morador. Parcelas quitadas
  // permanecem no histórico, mas ficam fora de todos os totais.
  function resumoMorador(m) {
    let condominio = 0, juros = 0, multa = 0, total = 0, maxDias = 0, abertas = 0, pagas = 0, vencidas = 0;
    m.parcelas.forEach(p => {
      if (p.pago) { pagas++; return; }
      const c = calcParcela(p);
      if (c.dias > 0 && p.valor > 0) vencidas++;
      abertas++;
      condominio += p.valor;
      juros += c.juros;
      multa += c.multa;
      total += c.total;
      if (p.valor > 0 && c.dias > maxDias) maxDias = c.dias;
    });
    return { condominio, juros, multa, total, maxDias, abertas, pagas, vencidas };
  }

  function statusMorador(m, r) {
    if (m.parcelas.some(p => !p.pago && (!dataValida(p.venc) || !dataValida(p.ref)))) return 'revisar';
    if (m.situacao === 'Isento') return 'isento';
    if (m.situacao === 'Cobrança jurídica') return 'juridico';
    if (m.situacao === 'Em acordo') return 'acordo';
    if (r.abertas === 0 || r.total <= 0) return 'adimplente';
    if (!r.vencidas) return 'avencer';
    if (r.maxDias <= DIAS_ATRASO_RECENTE) return 'atraso';
    if (r.maxDias <= DIAS_CRITICO) return 'inadimplente';
    return 'critico';
  }

  // Considera "devendo" quem tem parcela em aberto, inclusive acordo/jurídico
  const estaDevendo = r => r.vencidas > 0 && r.total > 0;

  /* ==========================================================
     6. SINCRONIZAÇÃO COM O FIRESTORE
     ========================================================== */
  /* ==========================================================
     6. SINCRONIZAÇÃO COM O FIRESTORE
     Uma transação compara somente os cadastros alterados neste
     aparelho. Dados remotos ainda não exibidos nunca viram a base
     de uma edição local. Os dados pessoais ficam apenas na memória.
     ========================================================== */
  let syncPronto = false;
  let syncBaseServidor = null;
  let syncBaseLocal = null;
  let syncPromessa = null;
  let syncEscuta = null;
  let syncSessao = 0;
  let syncUID = null;
  let syncErro = null;
  let syncRemotoPendente = null;
  let syncEventoRemoto = 0;
  let syncConectado = navigator.onLine;

  const copiarSync = valor => JSON.parse(JSON.stringify(valor));
  // A ordem das propriedades do Firestore não representa uma alteração.
  function assinaturaSync(valor) {
    if (valor === undefined) return 'undefined';
    if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
    if (Array.isArray(valor)) return '[' + valor.map(assinaturaSync).join(',') + ']';
    return '{' + Object.keys(valor).sort().map(k => JSON.stringify(k) + ':' + assinaturaSync(valor[k])).join(',') + '}';
  }
  const iguaisSync = (a, b) => assinaturaSync(a) === assinaturaSync(b);
  function modeloSync(dados) {
    dados = dados || {};
    return {
      moradores: copiarSync(dados.moradores && typeof dados.moradores === 'object' && !Array.isArray(dados.moradores) ? dados.moradores : {}),
      taxaJuros: Number.isFinite(Number(dados.taxaJuros)) ? Number(dados.taxaJuros) : 1,
      taxaMulta: Number.isFinite(Number(dados.taxaMulta)) ? Number(dados.taxaMulta) : 2
    };
  }
  function estadoLocalSync() {
    return {
      moradores: copiarSync(moradores),
      taxaJuros: taxasAtivas.taxaJuros,
      taxaMulta: taxasAtivas.taxaMulta
    };
  }
  function alteracoesSync(base, atual) {
    return {
      moradores: [...new Set([...Object.keys(base.moradores), ...Object.keys(atual.moradores)])]
        .filter(k => !iguaisSync(base.moradores[k], atual.moradores[k])),
      taxas: ['taxaJuros', 'taxaMulta'].filter(k => !iguaisSync(base[k], atual[k]))
    };
  }
  function temAlteracoesSync() {
    return syncPronto && syncBaseLocal && !iguaisSync(syncBaseLocal, estadoLocalSync());
  }
  function sessaoValidaSync(sessao) {
    return sessao === syncSessao && auth.currentUser && auth.currentUser.uid === syncUID;
  }
  function editandoSync() {
    const el = document.activeElement;
    return !!(el && el.matches('input, select, textarea, [contenteditable="true"]')) ||
      !!($('modalCadastro') && !$('modalCadastro').classList.contains('hidden'));
  }
  function setSync(estado, texto) {
    const el = $('syncIndicator');
    if (!el) return;
    el.className = estado;
    el.textContent = texto;
  }
  function bloquearDuranteCargaSync(bloquear, texto) {
    const conteudo = $('appContent');
    if (conteudo) {
      conteudo.inert = bloquear;
      conteudo.setAttribute('aria-busy', String(bloquear));
    }
    const carga = $('loadingState');
    if (carga) {
      carga.classList.toggle('hidden', !bloquear);
      carga.textContent = texto || 'Carregando os dados do condomínio…';
    }
  }
  function avisoSync(texto, acoes) {
    const el = $('noticeRegion');
    if (!el) return;
    el.replaceChildren();
    el.classList.toggle('hidden', !texto);
    if (!texto) return;
    const mensagem = document.createElement('p');
    mensagem.textContent = texto;
    el.appendChild(mensagem);
    (acoes || []).forEach(([rotulo, acao]) => {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'btn btn-secondary';
      botao.textContent = rotulo;
      botao.addEventListener('click', acao);
      el.appendChild(botao);
    });
  }
  function atualizarEstadoSync() {
    if (!auth.currentUser) return;
    const alterado = temAlteracoesSync();
    if (syncErro && syncErro.tipo === 'carga') {
      setSync('erro', 'Dados indisponíveis');
      avisoSync('Não foi possível obter os dados do servidor. A edição está pausada para proteger os cadastros.', [['Tentar novamente', () => carregarDados()]]);
    } else if (syncErro && syncErro.tipo === 'conflito') {
      setSync('erro', 'Revisão necessária');
      avisoSync('Outro aparelho alterou ' + syncErro.detalhe + '. Suas edições continuam neste aparelho e ainda não foram salvas. Baixe uma cópia antes de recarregar os dados.', [
        ['Baixar cópia das minhas edições', exportarCopiaSync],
        ['Recarregar dados', recarregarComConfirmacaoSync]
      ]);
    } else if (syncErro) {
      setSync('erro', 'Alterações não salvas');
      avisoSync('Não foi possível confirmar a gravação. Mantenha esta página aberta e tente novamente; você também pode baixar uma cópia das suas edições.', [
        ['Tentar salvar novamente', tentarSalvarSync],
        ['Baixar cópia das minhas edições', exportarCopiaSync]
      ]);
    } else if (!navigator.onLine || !syncConectado) {
      setSync('erro', navigator.onLine ? 'Conectando…' : 'Sem conexão');
      avisoSync(alterado ? 'Há alterações apenas neste aparelho. Mantenha a página aberta até a confirmação da gravação; não existe cópia automática offline.' : 'Sem confirmação de conexão com o servidor. As próximas edições só serão salvas quando a conexão voltar.',
        alterado ? [['Tentar salvar novamente', tentarSalvarSync], ['Baixar cópia das minhas edições', exportarCopiaSync]] : []);
    } else if (syncRemotoPendente) {
      setSync(alterado || syncPromessa ? 'saving' : 'ok', alterado ? 'Alterações pendentes' : 'Novidades disponíveis');
      avisoSync('Há atualizações de outro aparelho. A tela foi preservada para você concluir a edição.', [[alterado ? 'Salvar e atualizar' : 'Ver novidades', atualizarNovidadesSync]]);
    } else {
      setSync(!syncPronto || alterado || syncPromessa ? 'saving' : 'ok', !syncPronto ? 'Carregando…' : syncPromessa ? 'Salvando…' : alterado ? 'Alterações pendentes' : 'Salvo na nuvem');
      avisoSync('');
    }
  }
  function redesenharAposSync() {
    renderGeral();
    if (moradorAtivoKey && !moradores[moradorAtivoKey]) {
      fecharMorador();
      return;
    }
    if (moradorAtivoKey) {
      const fichaAberta = $('fichaBloco').classList.contains('aberta');
      const parametrosAbertos = $('paramBloco').classList.contains('aberta');
      renderFicha();
      $('fichaBloco').classList.toggle('aberta', fichaAberta);
      $('paramBloco').classList.toggle('aberta', parametrosAbertos);
      renderIndividual();
      atualizarAcordeoes();
    }
  }
  function aplicarServidorSync(dados) {
    syncBaseServidor = modeloSync(dados);
    moradores = copiarSync(syncBaseServidor.moradores);
    taxasAtivas.taxaJuros = numeroSeguro(syncBaseServidor.taxaJuros);
    taxasAtivas.taxaMulta = numeroSeguro(syncBaseServidor.taxaMulta);
    $('taxaJuros').value = taxasAtivas.taxaJuros;
    $('taxaMulta').value = taxasAtivas.taxaMulta;
    normalizarTodos();
    syncBaseLocal = estadoLocalSync();
    syncRemotoPendente = null;
    redesenharAposSync();
  }
  function receberServidorSync(dados) {
    const modelo = modeloSync(dados);
    if (iguaisSync(modelo, syncBaseServidor)) {
      syncRemotoPendente = null;
    } else if (temAlteracoesSync() || syncPromessa || editandoSync() || syncErro) {
      syncRemotoPendente = dados || {};
    } else {
      aplicarServidorSync(dados);
    }
    atualizarEstadoSync();
  }
  function iniciarEscutaSync(sessao) {
    if (syncEscuta) syncEscuta();
    syncEscuta = docRef.onSnapshot({ includeMetadataChanges: true }, snap => {
      if (!sessaoValidaSync(sessao)) return;
      // Eventos de cache ou escrita pendente não confirmam persistência.
      syncConectado = !snap.metadata.fromCache;
      if (snap.metadata.fromCache || snap.metadata.hasPendingWrites) {
        atualizarEstadoSync();
        return;
      }
      syncEventoRemoto++;
      receberServidorSync(snap.exists ? snap.data() : {});
    }, () => {
      if (!sessaoValidaSync(sessao)) return;
      syncConectado = false;
      atualizarEstadoSync();
    });
  }
  async function conferirServidorSync(sessao) {
    const evento = syncEventoRemoto;
    try {
      const snap = await docRef.get({ source: 'server' });
      if (!sessaoValidaSync(sessao)) return;
      syncConectado = true;
      // Um evento mais recente da escuta vence uma leitura já em andamento.
      if (evento === syncEventoRemoto) receberServidorSync(snap.exists ? snap.data() : {});
      else if (syncRemotoPendente && !temAlteracoesSync() && !syncPromessa && !editandoSync() && !syncErro) aplicarServidorSync(syncRemotoPendente);
    } catch (_) {
      if (sessaoValidaSync(sessao)) syncConectado = false;
    }
    if (sessaoValidaSync(sessao)) atualizarEstadoSync();
  }
  function agendarSalvamento() {
    if (!syncPronto || !auth.currentUser) return;
    clearTimeout(saveTimer);
    if (!syncErro) saveTimer = setTimeout(() => { salvarAgora(); }, 700);
    atualizarEstadoSync();
  }
  function salvarAgora() {
    clearTimeout(saveTimer);
    if (syncPromessa) return syncPromessa;
    if (!syncPronto || !auth.currentUser) return Promise.resolve(false);
    if (syncErro) return Promise.resolve(false);
    if (!temAlteracoesSync()) return Promise.resolve(true);
    if (!navigator.onLine) {
      syncConectado = false;
      atualizarEstadoSync();
      return Promise.resolve(false);
    }
    const sessao = syncSessao;
    const executar = async () => {
      while (sessaoValidaSync(sessao) && temAlteracoesSync()) {
        const enviado = estadoLocalSync();
        const base = copiarSync(syncBaseServidor);
        const alteracoes = alteracoesSync(syncBaseLocal, enviado);
        try {
          const confirmado = await db.runTransaction(async transacao => {
            if (!sessaoValidaSync(sessao)) throw new Error('sessao-encerrada');
            const snap = await transacao.get(docRef);
            if (!sessaoValidaSync(sessao)) throw new Error('sessao-encerrada');
            const bruto = snap.exists ? snap.data() : {};
            const remoto = modeloSync(bruto);
            const conflitos = alteracoes.moradores.filter(k => !iguaisSync(remoto.moradores[k], base.moradores[k]));
            const taxasConflitantes = alteracoes.taxas.filter(k => !iguaisSync(remoto[k], base[k]));
            if (conflitos.length || taxasConflitantes.length) {
              const erro = new Error('conflito-remoto');
              erro.syncConflito = conflitos.length ? 'um cadastro que você também editou' : 'os parâmetros de juros ou multa';
              throw erro;
            }
            const mesclado = copiarSync(remoto);
            alteracoes.moradores.forEach(k => {
              // Ausência só exclui um cadastro se ele existia na base local.
              if (Object.prototype.hasOwnProperty.call(enviado.moradores, k)) mesclado.moradores[k] = copiarSync(enviado.moradores[k]);
              else delete mesclado.moradores[k];
            });
            alteracoes.taxas.forEach(k => { mesclado[k] = enviado[k]; });
            transacao.set(docRef, { ...bruto, ...mesclado, versaoEsquema: 2, atualizadoEm: new Date().toISOString() });
            return mesclado;
          });
          if (!sessaoValidaSync(sessao)) return false;
          // Atualize somente o que foi enviado. Edições feitas durante o
          // await continuam diferentes da base e entram na próxima transação.
          alteracoes.moradores.forEach(k => {
            if (Object.prototype.hasOwnProperty.call(enviado.moradores, k)) {
              syncBaseLocal.moradores[k] = copiarSync(enviado.moradores[k]);
              syncBaseServidor.moradores[k] = copiarSync(confirmado.moradores[k]);
            } else {
              delete syncBaseLocal.moradores[k];
              delete syncBaseServidor.moradores[k];
            }
          });
          alteracoes.taxas.forEach(k => {
            syncBaseLocal[k] = enviado[k];
            syncBaseServidor[k] = confirmado[k];
          });
          syncConectado = true;
        } catch (erro) {
          if (!sessaoValidaSync(sessao)) return false;
          syncErro = erro.syncConflito ? { tipo: 'conflito', detalhe: erro.syncConflito } : { tipo: 'salvar' };
          return false;
        }
      }
      return !!sessaoValidaSync(sessao);
    };
    syncPromessa = executar().finally(() => {
      if (sessao !== syncSessao) return;
      syncPromessa = null;
      atualizarEstadoSync();
      if (!syncErro) conferirServidorSync(sessao);
    });
    atualizarEstadoSync();
    return syncPromessa;
  }
  function tentarSalvarSync() {
    if (syncErro && syncErro.tipo === 'conflito') return;
    syncErro = null;
    if (!syncPronto) return carregarDados();
    // Recria uma escuta que tenha sido encerrada por erro de conexão/permissão.
    iniciarEscutaSync(syncSessao);
    return salvarAgora();
  }
  async function atualizarNovidadesSync() {
    if (temAlteracoesSync() && !(await salvarAgora())) return;
    if (editandoSync() || temAlteracoesSync()) return;
    await conferirServidorSync(syncSessao);
  }
  function exportarCopiaSync() {
    const dados = { ...estadoLocalSync(), versaoEsquema: 2, exportadoEm: new Date().toISOString(), origem: 'copia-local-nao-confirmada' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'monte-verde-copia-local-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function recarregarComConfirmacaoSync() {
    if (temAlteracoesSync() && !confirm('Recarregar descartará as edições ainda não salvas neste aparelho e exibirá os dados da nuvem. Baixe sua cópia antes de continuar. Descartar as edições locais e recarregar?')) return;
    carregarDados();
  }
  async function carregarDados() {
    pararSincronizacao();
    if (!auth.currentUser) return false;
    syncUID = auth.currentUser.uid;
    const sessao = syncSessao;
    bloquearDuranteCargaSync(true);
    atualizarEstadoSync();
    try {
      const snap = await docRef.get({ source: 'server' });
      if (!sessaoValidaSync(sessao)) return false;
      aplicarServidorSync(snap.exists ? snap.data() : {});
      syncPronto = true;
      syncConectado = true;
      bloquearDuranteCargaSync(false);
      iniciarEscutaSync(sessao);
      atualizarEstadoSync();
      return true;
    } catch (_) {
      if (!sessaoValidaSync(sessao)) return false;
      syncErro = { tipo: 'carga' };
      bloquearDuranteCargaSync(true, 'Conecte-se à internet e tente carregar novamente.');
      atualizarEstadoSync();
      return false;
    }
  }
  function pararSincronizacao() {
    clearTimeout(saveTimer);
    if (syncEscuta) syncEscuta();
    syncEscuta = null;
    syncSessao++;
    syncPronto = false;
    syncUID = null;
    syncBaseServidor = null;
    syncBaseLocal = null;
    syncPromessa = null;
    syncErro = null;
    syncRemotoPendente = null;
    avisoSync('');
    bloquearDuranteCargaSync(true);
  }
  async function sairComSeguranca() {
    const botao = $('btnLogout');
    const conteudo = $('appContent');
    const estavaInerte = conteudo ? conteudo.inert : true;
    if (botao) botao.disabled = true;
    if (conteudo) conteudo.inert = true;
    try {
      if (temAlteracoesSync() || syncPromessa) {
        if (!(await salvarAgora()) || temAlteracoesSync()) {
          atualizarEstadoSync();
          return;
        }
      }
      await auth.signOut();
    } catch (_) {
      avisoSync('Não foi possível encerrar a sessão. Tente novamente.', [['Tentar sair novamente', sairComSeguranca]]);
    } finally {
      if (botao) botao.disabled = false;
      if (conteudo && auth.currentUser) conteudo.inert = estavaInerte;
    }
  }
  window.addEventListener('offline', () => { syncConectado = false; atualizarEstadoSync(); });
  window.addEventListener('online', () => {
    if (!auth.currentUser) return;
    if (!syncPronto) { carregarDados(); return; }
    if (!syncErro || syncErro.tipo !== 'conflito') tentarSalvarSync();
    conferirServidorSync(syncSessao);
  });
  window.addEventListener('beforeunload', evento => {
    if (document.activeElement?.matches('.ficha [data-campo], #taxaJuros, #taxaMulta')) document.activeElement.dispatchEvent(new Event('change'));
    if (temAlteracoesSync() || syncPromessa) {
      evento.preventDefault();
      evento.returnValue = '';
    }
  });
  // iOS pode suspender a página imediatamente; isto é uma tentativa,
  // nunca uma garantia de gravação após fechar o navegador.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (document.activeElement?.matches('.ficha [data-campo], #taxaJuros, #taxaMulta')) document.activeElement.dispatchEvent(new Event('change'));
      if (temAlteracoesSync()) salvarAgora();
    }
  });


  /* ==========================================================
     7. LOGIN
     ========================================================== */
  auth.onAuthStateChanged(user => {
    if (user) {
      $('loginOverlay').classList.add('hidden');
      $('appWrap').classList.remove('hidden');
      carregarDados();
    } else {
      pararSincronizacao();
      moradores = {}; moradorAtivoKey = null;
      $('tbodyGeral').replaceChildren(); $('tbodyIndividual').replaceChildren();
      $('viewGeral').classList.remove('hidden'); $('viewIndividual').classList.add('hidden');
      fecharModalCadastro(false);
      $('loginSenha').value = '';
      $('loginOverlay').classList.remove('hidden');
      $('appWrap').classList.add('hidden');
    }
  });

  $('loginBox').addEventListener('submit', async e => {
    e.preventDefault();
    if (!$('loginBox').reportValidity() || $('btnLogin').disabled) return;
    $('loginErro').textContent = '';
    $('btnLogin').disabled = true;
    $('btnLogin').textContent = 'Entrando…';
    try {
      await auth.signInWithEmailAndPassword($('loginEmail').value.trim(), $('loginSenha').value);
      $('loginSenha').value = '';
    } catch (err) {
      const mensagens = {
        'auth/network-request-failed': 'Sem conexão. Verifique sua internet e tente novamente.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco antes de tentar novamente.'
      };
      $('loginErro').textContent = mensagens[err.code] || 'Não foi possível entrar. Confira seu e-mail e senha.';
    } finally {
      $('btnLogin').disabled = false;
      $('btnLogin').textContent = 'Entrar';
    }
  });
  $('btnLogout').addEventListener('click', sairComSeguranca);

  /* ==========================================================
     8. LISTA GERAL — filtros, agrupamento e indicadores
     ========================================================== */
  const MESES_ABREV = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
  function nomeAutomaticoParcela(vencISO) {
    if (!vencISO) return '';
    const d = new Date(vencISO + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    let mesAnterior = d.getMonth() - 1;
    if (mesAnterior < 0) mesAnterior = 11;
    return MESES_ABREV[mesAnterior];
  }

  function montarLista() {
    return Object.keys(moradores).map(key => {
      const m = moradores[key];
      const r = resumoMorador(m);
      return { key, m, r, status: statusMorador(m, r) };
    });
  }

  function passaNoFiltro(item) {
    const { m, status } = item;
    if (filtros.quadra && (m.quadra || '') !== filtros.quadra) return false;
    if (filtros.tipo && m.tipo !== filtros.tipo) return false;
    if (filtros.ocupacao && m.ocupacao !== filtros.ocupacao) return false;
    if (filtros.status && status !== filtros.status) return false;
    if (filtros.busca) {
      const alvo = semAcento(`${m.nome} ${m.unidade} ${m.quadra} ${m.telefone} ${m.email} ${m.observacoes}`).toUpperCase();
      if (alvo.indexOf(filtros.busca) === -1) return false;
    }
    return true;
  }

  function ordenarLista(lista) {
    const modo = filtros.ordenar;
    return lista.sort((a, b) => {
      if (modo === 'nome') return a.m.nome.localeCompare(b.m.nome, 'pt-BR');
      if (modo === 'total') return b.r.total - a.r.total;
      if (modo === 'atraso') return b.r.maxDias - a.r.maxDias;
      return compararUnidade(a.m.unidade || a.m.nome, b.m.unidade || b.m.nome);
    });
  }

  function chaveDoGrupo(item) {
    if (filtros.agrupar === 'quadra') return item.m.quadra ? 'Quadra ' + item.m.quadra : 'Sem quadra definida';
    if (filtros.agrupar === 'tipo') return item.m.tipo;
    if (filtros.agrupar === 'ocupacao') return item.m.ocupacao;
    if (filtros.agrupar === 'status') return STATUS[item.status].label;
    return '';
  }

  function criarLinhaMorador(item, gid, oculto) {
    const { key, m, r, status } = item;
    const st = STATUS[status];
    const tr = document.createElement('tr');
    tr.className = 'linha-morador' + (oculto ? ' oculto' : '');
    if (gid) tr.setAttribute('data-grupo', gid);
    const infoUnidade = [
      m.unidade ? 'Unidade ' + esc(m.unidade) : '',
      m.quadra ? 'Quadra ' + esc(m.quadra) : ''
    ].filter(Boolean).join(' · ');
    tr.innerHTML = `
      <td class="celula-nome">
        <button type="button" class="link-morador resident-open" aria-label="Abrir ficha de ${esc(m.nome)}, unidade ${esc(m.unidade)}">${esc(m.nome || '(sem nome)')}</button>
        ${infoUnidade ? `<span class="sub-linha sub-unidade">${infoUnidade}</span>` : ''}
        ${m.telefone ? `<span class="sub-linha">${esc(m.telefone)}</span>` : ''}
      </td>
      <td class="col-unidade" data-label="Unidade">${esc(m.unidade || '—')}</td>
      <td class="col-quadra" data-label="Quadra"><span class="badge-quadra">${esc(m.quadra || '—')}</span></td>
      <td class="col-tipo" data-label="Tipo"><span class="badge-tipo">${esc(m.tipo)}</span></td>
      <td class="col-status" data-label="Adimplência"><span class="badge-status ${st.classe}">${esc(st.label)}</span></td>
      <td class="col-dias" data-label="Atraso máx."><span class="badge-dias ${r.maxDias > 0 ? 'atraso' : 'ok'}">${r.maxDias}</span></td>
      <td class="col-dias" data-label="Parcelas em aberto">${r.abertas}</td>
      <td class="col-num ${r.total > 0 ? 'val-total' : ''}" data-label="Total devido">${r.total > 0 ? fmtBRL(r.total) : '—'}</td>
    `;
    tr.dataset.key = key;
    return tr;
  }

  function criarLinhaGrupo(rotulo, qtd, totalGrupo, gid, aberto) {
    const tr = document.createElement('tr');
    tr.className = 'quadra-header grupo-header' + (aberto ? ' aberto' : '');
    tr.setAttribute('data-grupo', gid);
    tr.setAttribute('role', 'button');
    tr.setAttribute('tabindex', '0');
    tr.setAttribute('aria-expanded', aberto ? 'true' : 'false');
    const meta = `${qtd} ${qtd === 1 ? 'morador' : 'moradores'}` +
      (totalGrupo > 0 ? ` · ${fmtBRL(totalGrupo)} em aberto` : ' · em dia');
    tr.innerHTML = `<td colspan="8">` +
      `<span class="grupo-info">` +
        `<span class="grupo-nome">${esc(rotulo)}</span>` +
        `<span class="grupo-meta">${meta}</span>` +
      `</span>` +
      `<span class="chevron">▾</span>` +
    `</td>`;
    return tr;
  }

  function atualizarSelectQuadras(lista) {
    const quadras = Array.from(new Set(lista.map(i => i.m.quadra).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const el = $('fQuadra');
    const atual = el.value;
    el.innerHTML = '<option value="">Todas</option>' + quadras.map(q => `<option value="${esc(q)}">${esc(q)}</option>`).join('');
    el.value = quadras.indexOf(atual) >= 0 ? atual : '';
    if (el.value !== atual) filtros.quadra = el.value;
  }

  function renderGeral() {
    const target = $('tbodyGeral');
    const tbody = document.createElement('tbody');

    const listaCompleta = montarLista();
    atualizarSelectQuadras(listaCompleta);

    // --- indicadores do painel (sempre sobre o cadastro inteiro) ---
    let adimplentes = 0, inadimplentes = 0, acordos = 0, parcelasAbertas = 0;
    let gJuros = 0, gMulta = 0, gGeral = 0, gMaxDias = 0;
    listaCompleta.forEach(({ m, r, status }) => {
      gJuros += r.juros; gMulta += r.multa; gGeral += r.total;
      parcelasAbertas += r.abertas;
      if (r.maxDias > gMaxDias) gMaxDias = r.maxDias;
      if (status === 'acordo' || status === 'juridico') acordos++;
      if (status !== 'revisar') { if (estaDevendo(r)) inadimplentes++; else adimplentes++; }
    });
    const totalUnidades = listaCompleta.length;
    const pct = n => totalUnidades ? Math.round((n / totalUnidades) * 100) + '% do cadastro' : '—';
    const quadrasDistintas = new Set(listaCompleta.map(i => i.m.quadra).filter(Boolean)).size;

    $('kpiUnidades').textContent = totalUnidades;
    const revisoes = listaCompleta.filter(i => i.status === 'revisar').length;
    $('kpiQuadras').textContent = quadrasDistintas + (quadrasDistintas === 1 ? ' quadra' : ' quadras') + (revisoes ? ` · ${revisoes} para revisar` : '');
    $('kpiAdimplentes').textContent = adimplentes;
    $('kpiAdimplentesPct').textContent = pct(adimplentes);
    $('kpiInadimplentes').textContent = inadimplentes;
    $('kpiInadimplentesPct').textContent = pct(inadimplentes);
    $('kpiAcordos').textContent = acordos;
    $('kpiDivida').textContent = fmtBRL(gGeral);
    $('kpiParcelasAbertas').textContent = parcelasAbertas + (parcelasAbertas === 1 ? ' parcela em aberto' : ' parcelas em aberto');

    $('geralMaxDias').textContent = gMaxDias;
    $('geralTotJuros').textContent = fmtBRL(gJuros);
    $('geralTotMultas').textContent = fmtBRL(gMulta);
    $('geralTotGeral').textContent = fmtBRL(gGeral);
    $('geralCount').textContent = totalUnidades + (totalUnidades === 1 ? ' morador registrado' : ' moradores registrados');
    atualizarAvisoRef();

    // --- tabela (respeita filtros, ordenação e agrupamento) ---
    const lista = ordenarLista(listaCompleta.filter(passaNoFiltro));
    const totalFiltrado = lista.reduce((s, i) => s + i.r.total, 0);

    $('contadorFiltro').textContent = totalUnidades === 0
      ? 'Nenhum morador cadastrado ainda'
      : `Exibindo ${lista.length} de ${totalUnidades} moradores · ${fmtBRL(totalFiltrado)} em aberto nesta seleção`;

    // Marca no botão de filtros (celular) quantos filtros estão ativos.
    const filtrosAtivos = ['quadra', 'tipo', 'status', 'ocupacao'].filter(k => filtros[k]).length;
    const badgeFiltros = $('filtrosBadge');
    if (badgeFiltros) {
      badgeFiltros.textContent = filtrosAtivos || '';
      badgeFiltros.classList.toggle('tem', filtrosAtivos > 0);
    }

    if (totalUnidades === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="vazio">Nenhum morador cadastrado.<br>
        Use <strong>Cadastrar morador</strong> para incluir a primeira unidade.</td></tr>`;
      target.replaceChildren(...tbody.childNodes);
      return;
    }
    if (lista.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="vazio">Nenhum morador corresponde aos filtros selecionados.</td></tr>`;
      target.replaceChildren(...tbody.childNodes);
      return;
    }

    if (filtros.agrupar === 'nenhum') {
      lista.forEach(item => tbody.appendChild(criarLinhaMorador(item)));
      target.replaceChildren(...tbody.childNodes);
      return;
    }

    const grupos = Object.create(null);
    lista.forEach(item => {
      const g = chaveDoGrupo(item);
      if (!grupos[g]) grupos[g] = [];
      grupos[g].push(item);
    });

    let nomes = Object.keys(grupos);
    if (filtros.agrupar === 'status') {
      nomes.sort((a, b) => {
        const oa = Object.values(STATUS).find(s => s.label === a).ordem;
        const ob = Object.values(STATUS).find(s => s.label === b).ordem;
        return oa - ob;
      });
    } else {
      nomes.sort((a, b) => {
        if (a.indexOf('Sem quadra') === 0) return 1;
        if (b.indexOf('Sem quadra') === 0) return -1;
        return a.localeCompare(b, 'pt-BR');
      });
    }

    // No celular os grupos começam fechados (lista bem compacta). Abrem quando:
    // há busca ativa, existe um único grupo, ou o usuário já abriu aquela quadra.
    const celular = ehCelular();
    const umGrupo = nomes.length === 1;
    nomes.forEach((g, idx) => {
      const itens = grupos[g];
      const totalGrupo = itens.reduce((s, i) => s + i.r.total, 0);
      const gid = 'g' + idx;
      const aberto = !celular || filtros.busca !== '' || umGrupo || gruposAbertos.has(g);
      const header = criarLinhaGrupo(g, itens.length, totalGrupo, gid, aberto);
      header.setAttribute('data-nome', g);
      tbody.appendChild(header);
      itens.forEach(item => tbody.appendChild(criarLinhaMorador(item, gid, !aberto)));
    });
    target.replaceChildren(...tbody.childNodes);
  }

  /* ==========================================================
     9. CADASTRO DE MORADOR
     ========================================================== */
  function gerarChave(nome, unidade) {
    let base = semAcento(unidade || nome).toLowerCase()
      .trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_');
    if (!base) base = 'morador';
    let chave = base, i = 2;
    while (moradores[chave]) { chave = base + '_' + i; i++; }
    return chave;
  }

  function unidadeJaCadastrada(unidade, ignorarChave) {
    const alvo = normUnidade(unidade);
    if (!alvo) return null;
    return Object.keys(moradores).find(k => k !== ignorarChave && normUnidade(moradores[k].unidade) === alvo) || null;
  }

  let focoAntesModal = null;
  function abrirModalCadastro() {
    focoAntesModal = document.activeElement;
    $('appWrap').inert = true;
    document.body.classList.add('modal-open');
    ['cadNome','cadUnidade','cadQuadra','cadTelefone','cadEmail','cadObs'].forEach(id => $(id).value = '');
    $('cadTipo').value = 'Casa';
    $('cadOcupacao').value = 'Proprietário';
    $('cadSituacao').value = 'Normal';
    $('cadDiaVenc').value = 15;
    $('cadTaxa').value = 430;
    $('cadErro').textContent = '';
    $('modalCadastro').classList.remove('hidden');
    $('cadNome').focus();
  }

  function fecharModalCadastro(restaurar = true) {
    const estavaAberto = !$('modalCadastro').classList.contains('hidden');
    $('modalCadastro').classList.add('hidden');
    $('appWrap').inert = false;
    document.body.classList.remove('modal-open');
    if (restaurar && estavaAberto && focoAntesModal?.isConnected) focoAntesModal.focus();
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || $('modalCadastro').classList.contains('hidden')) return;
    const itens = [...$('modalCadastro').querySelectorAll('button, input, select, textarea')].filter(el => !el.disabled);
    const primeiro = itens[0], ultimo = itens[itens.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
    if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
  });

  function salvarCadastro() {
    for (const campo of $('modalCadastro').querySelectorAll('input')) {
      if (!campo.reportValidity()) return;
    }
    const nome = $('cadNome').value.trim();
    const unidade = $('cadUnidade').value.trim().toUpperCase();
    if (!nome) { $('cadErro').textContent = 'Informe o nome do morador.'; return; }
    if (!unidade) { $('cadErro').textContent = 'Informe a unidade ou lote.'; return; }

    const dup = unidadeJaCadastrada(unidade);
    if (dup) {
      $('cadErro').textContent = `A unidade ${unidade} já está cadastrada para ${moradores[dup].nome}.`;
      return;
    }

    const quadra = ($('cadQuadra').value.trim() || quadraDeUnidade(unidade)).toUpperCase();
    const chave = gerarChave(nome, unidade);
    moradores[chave] = normalizarMorador({
      nome, unidade, quadra,
      tipo: $('cadTipo').value,
      ocupacao: $('cadOcupacao').value,
      situacao: $('cadSituacao').value,
      telefone: $('cadTelefone').value.trim(),
      email: $('cadEmail').value.trim(),
      diaVencimento: parseInt($('cadDiaVenc').value, 10) || 15,
      valorTaxa: parseFloat($('cadTaxa').value) || 0,
      observacoes: $('cadObs').value.trim(),
      parcelas: []
    });
    moradores[chave].nomeExibicao = montarExibicao(moradores[chave]);

    fecharModalCadastro();
    renderGeral();
    agendarSalvamento();
  }

  function excluirMorador(key) {
    const m = moradores[key];
    if (!m) return;
    const ok = confirm(
      `Excluir o cadastro de "${m.nome} — unidade ${m.unidade}"?\n\n` +
      `Todas as parcelas lançadas para esta unidade serão apagadas junto. Essa ação não pode ser desfeita.`
    );
    if (!ok) return;
    delete moradores[key];
    agendarSalvamento();
    voltarParaLista();
  }

  /* ==========================================================
     10. FICHA INDIVIDUAL
     ========================================================== */
  // Ao abrir uma ficha, empilhamos um estado no histórico do navegador.
  // Assim o botão "voltar" do navegador apenas retorna à lista geral,
  // em vez de sair do site. O popstate (mais abaixo) faz o fechamento.
  let fichaNoHistorico = false;
  let posicaoLista = 0;
  let ultimaFicha = null;

  function abrirMorador(key) {
    if (!moradores[key]) return;
    posicaoLista = window.scrollY;
    ultimaFicha = key;
    moradorAtivoKey = key;
    $('viewGeral').classList.add('hidden');
    $('viewIndividual').classList.remove('hidden');
    renderFicha();
    renderIndividual();
    window.scrollTo(0, 0);
    $('tituloIndividual').focus({ preventScroll: true });
    if (!fichaNoHistorico) {
      history.pushState({ tela: 'ficha' }, '');
      fichaNoHistorico = true;
    }
  }

  // Fecha a ficha e volta para a lista. Quando o retorno parte de um
  // controle da própria página (botão "Voltar" ou exclusão), pedimos
  // history.back() para consumir o estado empilhado — o fechamento em si
  // acontece no popstate, evitando entradas duplicadas no histórico.
  function voltarParaLista() {
    if (fichaNoHistorico) history.back();
    else fecharMorador();
  }

  function fecharMorador() {
    moradorAtivoKey = null;
    $('viewIndividual').classList.add('hidden');
    $('viewGeral').classList.remove('hidden');
    renderGeral();
    window.scrollTo(0, posicaoLista);
    const linha = [...$('tbodyGeral').querySelectorAll('[data-key]')].find(el => el.dataset.key === ultimaFicha);
    linha?.querySelector('button')?.focus({ preventScroll: true });
  }

  window.addEventListener('popstate', () => {
    // Voltou pelo navegador estando dentro de uma ficha: mostra a lista.
    if (fichaNoHistorico) {
      fichaNoHistorico = false;
      if (moradorAtivoKey) fecharMorador();
    }
  });

  function renderFicha() {
    if (!moradorAtivoKey) return;
    const m = moradores[moradorAtivoKey];
    // No celular, os dados cadastrais começam recolhidos a cada morador aberto.
    $('fichaBloco').classList.remove('aberta');
    $('paramBloco').classList.remove('aberta');
    $('fiNome').value = m.nome;
    $('fiUnidade').value = m.unidade;
    $('fiQuadra').value = m.quadra;
    $('fiTipo').value = m.tipo;
    $('fiOcupacao').value = m.ocupacao;
    $('fiSituacao').value = m.situacao;
    $('fiTelefone').value = m.telefone;
    $('fiEmail').value = m.email;
    $('fiDiaVenc').value = m.diaVencimento;
    $('fiTaxa').value = m.valorTaxa;
    $('fiObs').value = m.observacoes;
    atualizarCabecalhoFicha();
    atualizarAcordeoes();
  }

  function atualizarCabecalhoFicha() {
    if (!moradorAtivoKey) return;
    const m = moradores[moradorAtivoKey];
    const r = resumoMorador(m);
    const st = STATUS[statusMorador(m, r)];
    $('tituloIndividual').textContent = montarExibicao(m) || '(sem nome)';
    const badge = $('fichaStatus');
    badge.className = 'badge-status ' + st.classe;
    badge.textContent = st.label;
    $('resumoIndividual').textContent =
      `${m.tipo} · ${m.ocupacao} · quadra ${m.quadra || '—'} · vencimento todo dia ${m.diaVencimento} · taxa mensal ${fmtBRL(m.valorTaxa)}`;
  }

  // Linha-resumo compacta de uma parcela (mostrada no cartão do celular).
  function resumoSubParcela(p, dias) {
    if (!dataValida(p.venc) || !dataValida(p.ref)) return 'Revise as datas · juros não calculados';
    const base = 'venc. ' + fmtData(p.venc);
    if (p.pago) return base + (p.calculoPago ? ' · paga' : ' · paga · valor estimado');
    if (dias > 0) return base + ' · ' + dias + (dias === 1 ? ' dia em atraso' : ' dias em atraso');
    return base + ' · em dia';
  }

  function renderIndividual() {
    if (!moradorAtivoKey) return;
    const m = moradores[moradorAtivoKey];
    const tbody = $('tbodyIndividual');
    tbody.innerHTML = '';

    if (m.parcelas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="vazio">Nenhuma parcela lançada — esta unidade está em dia.<br>
        Use <strong>Lançar parcela</strong> para registrar uma cobrança em aberto.</td></tr>`;
    }

    m.parcelas.forEach(p => {
      const { dias, juros, multa, total } = calcParcela(p);
      const tr = document.createElement('tr');
      tr.className = 'parcela' + (p.pago ? ' parcela-paga' : '');
      tr.innerHTML = `
        <td class="parcela-resumo" data-role="resumo" role="button" tabindex="0" aria-expanded="false" aria-label="Detalhes da parcela ${esc(p.nome || 'sem nome')}">
          <span class="pr-info">
            <span class="pr-nome">${esc(p.nome || '(sem nome)')}</span>
            <span class="pr-sub">${esc(resumoSubParcela(p, dias))}</span>
          </span>
          <span class="pr-valor" data-role="resumo-total">${fmtBRL(total)}</span>
          <span class="chevron">▾</span>
        </td>
        <td class="col-pago" data-label="Pago"><label class="payment-toggle"><span class="sr-only">Pago</span><input type="checkbox" class="chk-pago" data-field="pago" ${p.pago ? 'checked' : ''} title="marcar parcela como paga"></label></td>
        <td class="col-parcela" data-label="Parcela"><input type="text" data-field="nome" value="${esc(p.nome)}"></td>
        <td class="col-date" data-label="Vencimento"><input type="date" data-field="venc" value="${esc(p.venc)}"></td>
        <td class="col-date" data-label="Data ref."><input type="date" data-field="ref" value="${esc(p.ref)}"></td>
        <td class="col-num" data-label="Condomínio"><input type="number" step="0.01" data-field="valor" value="${p.valor}"></td>
        <td class="col-dias" data-label="Dias em atraso"><span class="badge-dias ${dias > 0 && !p.pago ? 'atraso' : 'ok'}" data-role="dias">${dias}</span></td>
        <td class="col-num" data-label="Juros"><span class="val-red" data-role="juros">${fmtBRL(juros)}</span></td>
        <td class="col-num" data-label="Multa"><span class="val-red" data-role="multa">${fmtBRL(multa)}</span></td>
        <td class="col-num" data-label="Total a pagar"><span class="val-total" data-role="total">${fmtBRL(total)}</span></td>
        <td class="col-remover"><button class="rm-btn" title="remover parcela">✕ <span class="rm-txt">Remover parcela</span></button></td>
      `;
      tbody.appendChild(tr);

      // Toca no resumo -> abre/fecha os campos editáveis da parcela (celular).
      tr.querySelector('.parcela-resumo').addEventListener('click', () => {
        const aberto = tr.classList.toggle('aberta');
        tr.querySelector('.parcela-resumo').setAttribute('aria-expanded', String(aberto));
      });

      const resumo = tr.querySelector('.parcela-resumo');
      resumo.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); resumo.click(); }
      });
      tr.querySelectorAll('input').forEach(inp => {
        inp.setAttribute('aria-label', inp.closest('td').dataset.label + ' · ' + (p.nome || 'parcela'));
        if (inp.type === 'number') { inp.required = true; inp.min = '0'; inp.inputMode = 'decimal'; }
        if (inp.type === 'date') inp.required = true;
      });
      tr.querySelector('[data-field="pago"]').addEventListener('change', e => {
        if (e.target.checked && (!dataValida(p.venc) || !dataValida(p.ref))) {
          e.target.checked = false; alert('Revise vencimento e data de referência antes de marcar como paga.'); return;
        }
        definirPagamento(p, e.target.checked);
        tr.classList.toggle('parcela-paga', p.pago);
        atualizarLinha(tr, p);
        atualizarTotaisIndividual();
        agendarSalvamento();
      });

      tr.querySelectorAll('input:not([type=checkbox])').forEach(inp => {
        inp.addEventListener('input', () => {
          if (!inp.checkValidity()) return;
          const field = inp.dataset.field;
          if (p.pago && field !== 'nome') { inp.value = p[field]; return; }
          p[field] = (field === 'valor') ? (parseFloat(inp.value) || 0) : inp.value;

          if (field === 'nome') p.nomeAuto = false;
          if (field === 'venc' && p.nomeAuto !== false) {
            p.nome = nomeAutomaticoParcela(p.venc);
            const inputNome = tr.querySelector('input[data-field="nome"]');
            if (inputNome) inputNome.value = p.nome;
          }
          // Só os campos calculados são reescritos: os <input> ficam intactos
          // e o foco não é perdido a cada tecla digitada.
          atualizarLinha(tr, p);
          atualizarTotaisIndividual();
          agendarSalvamento();
        });
      });

      atualizarLinha(tr, p);
      tr.querySelector('.rm-btn').setAttribute('aria-label', 'Remover parcela ' + (p.nome || 'sem nome'));
      tr.querySelector('.rm-btn').addEventListener('click', () => {
        if (!confirm(`Remover a parcela ${p.nome || '(sem nome)'} de ${fmtBRL(p.valor)}?`)) return;
        m.parcelas = m.parcelas.filter(x => x !== p);
        renderIndividual();
        agendarSalvamento();
      });
    });

    atualizarTotaisIndividual();
  }

  function definirPagamento(p, pago) {
    if (pago && !p.pago) {
      p.calculoPago = calcParcela(p);
      p.pagoEm = hojeISO();
    }
    if (!pago) { delete p.calculoPago; p.pagoEm = ''; }
    p.pago = pago;
  }
  function atualizarLinha(tr, p) {
    const { dias, juros, multa, total } = calcParcela(p);
    tr.querySelectorAll('input').forEach(inp => {
      if (['venc','ref','valor'].includes(inp.dataset.field)) { inp.disabled = p.pago; inp.title = p.pago ? 'Desmarque Pago para editar esta cobrança.' : ''; }
    });
    const spanDias = tr.querySelector('[data-role="dias"]');
    spanDias.textContent = dias;
    spanDias.className = 'badge-dias ' + (dias > 0 && !p.pago ? 'atraso' : 'ok');
    tr.querySelector('[data-role="juros"]').textContent = fmtBRL(juros);
    tr.querySelector('[data-role="multa"]').textContent = fmtBRL(multa);
    tr.querySelector('[data-role="total"]').textContent = fmtBRL(total);

    // Mantém o resumo compacto (cartão do celular) atualizado.
    const rt = tr.querySelector('[data-role="resumo-total"]');
    if (rt) rt.textContent = fmtBRL(total);
    const prNome = tr.querySelector('.pr-nome');
    if (prNome) prNome.textContent = p.nome || '(sem nome)';
    const prSub = tr.querySelector('.pr-sub');
    if (prSub) prSub.textContent = resumoSubParcela(p, dias);
  }

  function atualizarTotaisIndividual() {
    if (!moradorAtivoKey) return;
    const m = moradores[moradorAtivoKey];
    const r = resumoMorador(m);
    $('totJuros').textContent = fmtBRL(r.juros);
    $('totMultas').textContent = fmtBRL(r.multa);
    $('totGeral').textContent = fmtBRL(r.total);
    $('stampDias').textContent = r.maxDias > 0 ? r.maxDias : 0;
    $('parcelaCount').textContent =
      `${m.parcelas.length} ${m.parcelas.length === 1 ? 'parcela lançada' : 'parcelas lançadas'} · ${r.abertas} em aberto · ${r.pagas} ${r.pagas === 1 ? 'quitada' : 'quitadas'}`;
    atualizarCabecalhoFicha();
  }

  /* ==========================================================
     11. DATA DE REFERÊNCIA — ATUALIZAÇÃO EM MASSA
     ==========================================================
     A data de referência é o dia até o qual os juros de cada parcela
     são calculados. Como ela fica gravada parcela a parcela, esta
     rotina joga TODAS as parcelas em aberto, de TODOS os moradores,
     para o dia de hoje de uma só vez. Parcelas já quitadas não são
     tocadas: elas ficam congeladas na data em que foram baixadas.
  */
  function levantarReferencias() {
    const hoje = hojeISO();
    let parcelas = 0, atingidos = 0;
    Object.keys(moradores).forEach(k => {
      let n = 0;
      moradores[k].parcelas.forEach(p => { if (!p.pago && dataValida(p.ref) && p.ref < hoje) n++; });
      if (n) { parcelas += n; atingidos++; }
    });
    return { hoje, parcelas, atingidos };
  }

  function atualizarAvisoRef() {
    const el = $('avisoRef');
    if (!el) return;
    const { hoje, parcelas, atingidos } = levantarReferencias();
    if (parcelas === 0) {
      el.className = 'aviso-ref';
      el.textContent = `Nenhuma referência anterior a ${fmtData(hoje)}. Confira datas futuras ou pendentes nas fichas.`;
    } else {
      el.className = 'aviso-ref pendente';
      el.textContent = `${parcelas} ${parcelas === 1 ? 'parcela está' : 'parcelas estão'} com data de referência anterior a hoje, ` +
        `em ${atingidos} ${atingidos === 1 ? 'morador' : 'moradores'}.`;
    }
  }

  function atualizarReferenciaGeral() {
    const { hoje, parcelas, atingidos } = levantarReferencias();

    if (parcelas === 0) {
      alert(`Nada a atualizar: todas as parcelas em aberto já calculam juros até ${fmtData(hoje)}.`);
      return;
    }

    const ok = confirm(
      `Atualizar a data de referência para ${fmtData(hoje)} em ${parcelas} ${parcelas === 1 ? 'parcela' : 'parcelas'} ` +
      `de ${atingidos} ${atingidos === 1 ? 'morador' : 'moradores'}?\n\n` +
      `Os juros passam a ser calculados até hoje e os totais da lista sobem de acordo. ` +
      `Parcelas já marcadas como pagas não são alteradas.`
    );
    if (!ok) return;

    Object.keys(moradores).forEach(k => {
      moradores[k].parcelas.forEach(p => { if (!p.pago && dataValida(p.ref) && p.ref < hoje) p.ref = hoje; });
    });

    $('dataRef').value = hoje;
    renderGeral();
    if (moradorAtivoKey) renderIndividual();
    agendarSalvamento();
  }

  /* ==========================================================
     12. EXPORTAÇÃO CSV
     ========================================================== */
  function exportarCsv() {
    const num = v => (v || 0).toFixed(2).replace('.', ',');
    const cabecalho = ['Unidade','Quadra','Morador','Tipo','Ocupacao','Situacao','Adimplencia',
      'Parcelas em aberto','Parcelas pagas','Dias de atraso','Condominio','Juros','Multa','Total devido',
      'Telefone','E-mail','Dia vencimento','Taxa mensal','Observacoes'];

    const linhas = ordenarLista(montarLista().filter(passaNoFiltro)).map(({ m, r, status }) => [
      m.unidade, m.quadra, m.nome, m.tipo, m.ocupacao, m.situacao, STATUS[status].label,
      r.abertas, r.pagas, r.maxDias, num(r.condominio), num(r.juros), num(r.multa), num(r.total),
      m.telefone, m.email, m.diaVencimento, num(m.valorTaxa), (m.observacoes || '').replace(/[\r\n]+/g, ' ')
    ]);

    const csv = [cabecalho].concat(linhas)
      .map(l => l.map(celulaCsv).join(';'))
      .join('\r\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `moradores_condominio_${hojeISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // Exporta a ficha completa de UM morador: dados cadastrais, resumo
  // financeiro e o detalhamento de cada parcela lan\u00E7ada (paga ou em aberto).
  function exportarCsvMorador(key) {
    const m = moradores[key];
    if (!m) return;

    const num = v => (v || 0).toFixed(2).replace('.', ',');
    const linha = arr => arr
      .map(celulaCsv)
      .join(';');

    const r = resumoMorador(m);
    const st = STATUS[statusMorador(m, r)];

    const linhas = [];
    linhas.push(linha(['FICHA DO MORADOR']));
    linhas.push(linha([]));
    linhas.push(linha(['DADOS CADASTRAIS']));
    linhas.push(linha(['Nome', m.nome]));
    linhas.push(linha(['Unidade', m.unidade]));
    linhas.push(linha(['Quadra', m.quadra]));
    linhas.push(linha(['Tipo de resid\u00EAncia', m.tipo]));
    linhas.push(linha(['Ocupa\u00E7\u00E3o', m.ocupacao]));
    linhas.push(linha(['Situa\u00E7\u00E3o de cobran\u00E7a', m.situacao]));
    linhas.push(linha(['Adimpl\u00EAncia', st.label]));
    linhas.push(linha(['Telefone', m.telefone]));
    linhas.push(linha(['E-mail', m.email]));
    linhas.push(linha(['Dia de vencimento do boleto', m.diaVencimento]));
    linhas.push(linha(['Taxa mensal (R$)', num(m.valorTaxa)]));
    linhas.push(linha(['Observa\u00E7\u00F5es', (m.observacoes || '').replace(/[\r\n]+/g, ' ')]));
    linhas.push(linha([]));

    linhas.push(linha(['RESUMO FINANCEIRO']));
    linhas.push(linha(['Parcelas em aberto', r.abertas]));
    linhas.push(linha(['Parcelas pagas', r.pagas]));
    linhas.push(linha(['Dias de atraso (m\u00E1ximo)', r.maxDias]));
    linhas.push(linha(['Total condom\u00EDnio em aberto (R$)', num(r.condominio)]));
    linhas.push(linha(['Total juros (R$)', num(r.juros)]));
    linhas.push(linha(['Total multa (R$)', num(r.multa)]));
    linhas.push(linha(['Total devido (R$)', num(r.total)]));
    linhas.push(linha([]));

    linhas.push(linha(['PARCELAS']));
    linhas.push(linha([
      'Parcela', 'Pago', 'Pago em', 'Vencimento', 'Data ref.',
      'Condom\u00EDnio', 'Dias de atraso', 'Juros', 'Multa', 'Total calculado (histórico antigo sem registro: estimado)'
    ]));
    if (m.parcelas.length === 0) {
      linhas.push(linha(['(nenhuma parcela lan\u00E7ada)']));
    } else {
      m.parcelas.forEach(p => {
        const { dias, juros, multa, total } = calcParcela(p);
        linhas.push(linha([
          p.nome, p.pago ? 'Sim' : 'N\u00E3o', p.pagoEm ? fmtData(p.pagoEm) : '',
          fmtData(p.venc), fmtData(p.ref), num(p.valor), dias, num(juros), num(multa), num(total)
        ]));
      });
    }

    const csv = linhas.join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const nomeArquivo = semAcento(`${m.unidade || key}_${m.nome || 'morador'}`)
      .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    a.download = `morador_${nomeArquivo}_${hojeISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /* ==========================================================
     13. EVENTOS
     ========================================================== */
  $('dataRef').value = todayISO;
  preencherSelect($('cadTipo'), TIPOS);
  preencherSelect($('cadOcupacao'), OCUPACOES);
  preencherSelect($('cadSituacao'), SITUACOES);
  preencherSelect($('fiTipo'), TIPOS);
  preencherSelect($('fiOcupacao'), OCUPACOES);
  preencherSelect($('fiSituacao'), SITUACOES);
  preencherSelect($('fTipo'), TIPOS, 'Todos');
  preencherSelect($('fOcupacao'), OCUPACOES, 'Todas');
  preencherSelect($('fStatus'), Object.keys(STATUS).map(k => ({ valor: k, rotulo: STATUS[k].label })), 'Todas');

  // Filtros
  let buscaTimer;
  $('fBusca').addEventListener('input', e => { filtros.busca = semAcento(e.target.value).toUpperCase().trim(); clearTimeout(buscaTimer); buscaTimer = setTimeout(renderGeral, 160); });
  [['fQuadra','quadra'],['fTipo','tipo'],['fStatus','status'],['fOcupacao','ocupacao'],['fAgrupar','agrupar'],['fOrdenar','ordenar']]
    .forEach(([id, campo]) => $(id).addEventListener('change', e => { filtros[campo] = e.target.value; renderGeral(); }));

  $('btnLimparFiltros').addEventListener('click', () => {
    filtros.busca = ''; filtros.quadra = ''; filtros.tipo = ''; filtros.status = ''; filtros.ocupacao = '';
    $('fBusca').value = ''; $('fQuadra').value = ''; $('fTipo').value = ''; $('fStatus').value = ''; $('fOcupacao').value = '';
    renderGeral();
  });

  // Abre/fecha o bloco de filtros e ordenação no celular.
  $('btnToggleFiltros').addEventListener('click', function () {
    const book = this.closest('.book');
    const aberto = book.classList.toggle('mostra-filtros');
    this.setAttribute('aria-expanded', aberto ? 'true' : 'false');
  });

  // Botão flutuante do celular: mesmo cadastro do botão principal.
  $('fabCadastro').addEventListener('click', abrirModalCadastro);

  // Acordeão de quadras (celular): tocar no cartão da quadra abre/fecha a lista
  // de moradores daquela quadra. No desktop a lista fica sempre expandida.
  function alternarGrupo(header) {
    const gid = header.getAttribute('data-grupo');
    const nome = header.getAttribute('data-nome');
    const abrir = header.getAttribute('aria-expanded') !== 'true';
    header.setAttribute('aria-expanded', abrir ? 'true' : 'false');
    header.classList.toggle('aberto', abrir);
    if (abrir) gruposAbertos.add(nome); else gruposAbertos.delete(nome);
    $('tbodyGeral').querySelectorAll('tr.linha-morador[data-grupo="' + gid + '"]')
      .forEach(tr => tr.classList.toggle('oculto', !abrir));
  }
  $('tbodyGeral').addEventListener('click', function (e) {
    const linha = e.target.closest('tr.linha-morador');
    if (linha) { abrirMorador(linha.dataset.key); return; }
    if (!ehCelular()) return;
    const header = e.target.closest('tr.grupo-header');
    if (header && this.contains(header)) alternarGrupo(header);
  });
  $('tbodyGeral').addEventListener('keydown', function (e) {
    if (!ehCelular() || (e.key !== 'Enter' && e.key !== ' ')) return;
    const header = e.target.closest('tr.grupo-header');
    if (header && this.contains(header)) { e.preventDefault(); alternarGrupo(header); }
  });

  // Cadastro
  $('btnAbrirCadastro').addEventListener('click', abrirModalCadastro);
  $('cadCancelar').addEventListener('click', () => fecharModalCadastro());
  $('cadSalvar').addEventListener('click', salvarCadastro);
  ['cadNome','cadUnidade','cadQuadra'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); salvarCadastro(); } });
  });

  // Exportação e data de referência
  $('btnAtualizarRefGeral').addEventListener('click', atualizarReferenciaGeral);
  $('btnExportarCsv').addEventListener('click', exportarCsv);
  $('btnExportarCsvMorador').addEventListener('click', () => { if (moradorAtivoKey) exportarCsvMorador(moradorAtivoKey); });

  // Fecha a janela de cadastro ao clicar fora ou apertar Esc
  $('modalCadastro').addEventListener('click', e => {
    if (e.target.id === 'modalCadastro') fecharModalCadastro();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') fecharModalCadastro();
  });

  // Ficha individual
  $('btnVoltar').addEventListener('click', voltarParaLista);
  $('btnExcluirMorador').addEventListener('click', () => { if (moradorAtivoKey) excluirMorador(moradorAtivoKey); });

  // Acordeão dos dados cadastrais (celular): o cabeçalho abre/fecha o formulário.
  $('fichaCabecalho').addEventListener('click', () => {
    if (ehCelular()) $('fichaBloco').classList.toggle('aberta');
  });

  // Acordeão dos parâmetros de cálculo (celular).
  $('paramCabecalho').addEventListener('click', () => {
    if (ehCelular()) $('paramBloco').classList.toggle('aberta');
  });

  document.querySelectorAll('.ficha [data-campo]').forEach(el => {
    const evento = 'change';
    el.addEventListener(evento, () => {
      if (!moradorAtivoKey) return;
      const m = moradores[moradorAtivoKey];
      const campo = el.dataset.campo;
      if (!el.reportValidity()) return;
      let valor = el.value;
      if (campo === 'nome' && !valor.trim()) { el.value = m.nome; return; }
      if (campo === 'unidade' && (!valor.trim() || unidadeJaCadastrada(valor, moradorAtivoKey))) {
        alert('Informe uma unidade ainda não cadastrada.'); el.value = m.unidade; return;
      }

      if (campo === 'unidade' || campo === 'quadra') valor = valor.toUpperCase();
      if (campo === 'diaVencimento') valor = Math.min(31, Math.max(1, parseInt(valor, 10) || 1));
      if (campo === 'valorTaxa') valor = numeroSeguro(valor);

      m[campo] = valor;
      if (campo === 'unidade' && !m.quadra) {
        m.quadra = quadraDeUnidade(valor);
        $('fiQuadra').value = m.quadra;
      }
      m.nomeExibicao = montarExibicao(m);
      atualizarCabecalhoFicha();
      agendarSalvamento();
    });
  });

  // Parcelas
  $('btnAdd').addEventListener('click', () => {
    if (!moradorAtivoKey) return;
    const m = moradores[moradorAtivoKey];
    const venc = hojeISO();
    m.parcelas.push({
      id: novoId(),
      nome: nomeAutomaticoParcela(venc),
      valor: m.valorTaxa || 0,
      venc: venc,
      ref: $('dataRef').value || hojeISO(),
      pago: false,
      nomeAuto: true
    });
    renderIndividual();
    // No celular, já abre a parcela recém-criada para edição imediata.
    if (ehCelular()) {
      const linhas = $('tbodyIndividual').querySelectorAll('tr.parcela');
      if (linhas.length) { linhas[linhas.length - 1].classList.add('aberta'); linhas[linhas.length - 1].querySelector('.parcela-resumo').setAttribute('aria-expanded', 'true'); }
    }
    agendarSalvamento();
  });

  $('btnQuitarTudo').addEventListener('click', () => {
    if (!moradorAtivoKey) return;
    const m = moradores[moradorAtivoKey];
    if (m.parcelas.some(p => !p.pago && (!dataValida(p.venc) || !dataValida(p.ref)))) { alert('Revise as datas das parcelas antes de marcar todas como pagas.'); return; }
    const abertas = m.parcelas.filter(p => !p.pago).length;
    if (!abertas) return;
    if (!confirm(`Marcar as ${abertas} parcelas em aberto de ${m.nome} como pagas?`)) return;
    m.parcelas.forEach(p => { if (!p.pago) definirPagamento(p, true); });
    renderIndividual();
    agendarSalvamento();
  });

  $('btnAplicarRef').addEventListener('click', () => {
    if (!moradorAtivoKey) return;
    const ref = $('dataRef').value || hojeISO();
    if (!dataValida(ref)) return;
    moradores[moradorAtivoKey].parcelas.forEach(p => { if (!p.pago) p.ref = ref; });
    renderIndividual();
    agendarSalvamento();
  });

  ['taxaJuros', 'taxaMulta'].forEach(id => $(id).addEventListener('change', () => {
    if (!$(id).reportValidity()) return;
    taxasAtivas[id] = numeroSeguro($(id).value);
    renderIndividual(); agendarSalvamento();
  }));
  const mobileMedia = window.matchMedia('(max-width: 600px)');
  function atualizarAcordeoes() {
    [['fichaCabecalho','fichaBloco'],['paramCabecalho','paramBloco']].forEach(([cab, bloco]) => {
      $(cab).setAttribute('aria-expanded', String(!ehCelular() || $(bloco).classList.contains('aberta')));
    });
  }
  ['fichaCabecalho','paramCabecalho'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(id).click(); } });
    $(id).addEventListener('click', atualizarAcordeoes);
  });
  mobileMedia.addEventListener('change', () => { renderGeral(); atualizarAcordeoes(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { $('dataRef').value = hojeISO(); atualizarAvisoRef(); }
  });


  // A lista geral é renderizada após o login, em carregarDados().
})();