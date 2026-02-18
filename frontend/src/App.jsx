import { useState, useMemo, useEffect } from 'react'
import axios from 'axios'
import './App.css'
import logoPrefeitura from './assets/logo-prefeitura.png'

const ITENS_POR_PAGINA = 5;

const gerarIniciais = (nomeCompleto) => {
  if (!nomeCompleto) return 'Não informado';
  const partes = nomeCompleto.trim().split(' ');
  return partes.map(parte => parte[0].toUpperCase() + '.').join(' ');
}

const extrairAno = (dataString) => {
  if (!dataString) return "";
  if (dataString.includes('-')) return dataString.split('-')[0];
  if (dataString.includes('/')) {
    const partes = dataString.split('/');
    if (partes.length === 3) return partes[2];
  }
  return dataString.substring(0, 4);
};

const formatarData = (dataISO) => {
  if (!dataISO) return "-";
  try {
    const dataObj = new Date(dataISO);
    if (isNaN(dataObj.getTime())) return dataISO;
    
    return dataObj.toLocaleDateString('pt-BR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      timeZone: 'UTC' 
    });
  } catch (e) { return dataISO; }
};

const formatarDataHora = (dataISO) => {
  if (!dataISO) return "-";
  try {
    const dataObj = new Date(dataISO);
    if (isNaN(dataObj.getTime())) return dataISO;
    
    const dia = String(dataObj.getUTCDate()).padStart(2, '0');
    const mes = String(dataObj.getUTCMonth() + 1).padStart(2, '0');
    const ano = dataObj.getUTCFullYear();
    
    const hora = String(dataObj.getUTCHours()).padStart(2, '0');
    const min = String(dataObj.getUTCMinutes()).padStart(2, '0');

    return `${dia}/${mes}/${ano} às ${hora}:${min}`;
  } catch (e) { return dataISO; }
};

const formatarCPF = (cpf) => {
  const limpo = cpf.replace(/\D/g, '');
  return limpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

const PLANILHA_STATUS = {
  "SOLICITAÇÃO / PENDENTE / REGULADOR": "Pendente de análise da regulação",
  "SOLICITAÇÃO / DEVOLVIDA / REGULADOR": "Devolvida pela regulação para correção",
  "SOLICITAÇÃO / NEGADA / REGULADOR": "Solicitação negada pela regulação",
  "SOLICITAÇÃO / PENDENTE / FILA DE ESPERA": "Pendente de agendamento (Fila)",
  "SOLICITAÇÃO / REENVIADA / REGULADOR": "Reenviada para análise da regulação",
  "SOLICITAÇÃO / CANCELADA / SOLICITANTE": "Cancelada pelo solicitante",
  "SOLICITAÇÃO / CANCELADA / REGULADOR": "Cancelada pela regulação",
  "SOLICITAÇÃO / CANCELADA / COORDENADOR": "Cancelada pela coordenação",
  "SOLICITAÇÃO / AGENDADA / SOLICITANTE": "Agendada",
  "SOLICITAÇÃO / AGENDADA / COORDENADOR": "Agendada",
  "SOLICITAÇÃO / AUTORIZADA / REGULADOR": "Agendada",
  "SOLICITAÇÃO / AGENDADA / FILA DE ESPERA": "Agendada",
  "SOLICITAÇÃO INEXISTENTE": "Solicitação não encontrada",
  "NÃO DEFINIDO": "Solicitação não encontrada",
  "AGENDAMENTO / PENDENTE CONFIRMAÇÃO / EXECUTANTE": "Agendada pendente de confirmação",
  "AGENDAMENTO / CONFIRMADO / EXECUTANTE": "Agendada e Confirmada",
  "AGENDAMENTO / CANCELADO / REGULADOR": "Agendamento cancelado",
  "AGENDAMENTO / CANCELADO / SOLICITANTE": "Agendamento cancelado",
  "AGENDAMENTO / CANCELADO / COORDENADOR": "Agendamento cancelado",
  "AGENDAMENTO / CANCELADO": "Agendamento cancelado",
  "AGENDAMENTO / FALTA / USUARIO": "Paciente não compareceu",
  "FALTA": "Paciente não compareceu"
};

const traduzirStatus = (statusRaw) => {
  if (!statusRaw) return "Solicitação não encontrada";
  const st = String(statusRaw).toUpperCase(); 

  if (PLANILHA_STATUS[st]) return PLANILHA_STATUS[st];

  if (st.includes("FALTA")) return PLANILHA_STATUS["FALTA"];
  if (st.includes("AGENDAMENTO") && st.includes("CANCELADO")) return "Agendamento cancelado";
  if (st.includes("CONFIRMADO")) return "Agendada e Confirmada";
  if (st.includes("PENDENTE CONFIRMAÇÃO")) return "Agendada pendente de confirmação";
  if (st.includes("AGENDADA")) return "Agendada";
  if (st.includes("AUTORIZADA")) return "Agendada";
  if (st.includes("PENDENTE") && st.includes("FILA DE ESPERA")) return "Pendente de agendamento (Fila)";
  if (st.includes("PENDENTE") && st.includes("REGULADOR")) return "Pendente de análise da regulação";
  if (st.includes("DEVOLVIDA")) return "Devolvida pela regulação para correção";
  if (st.includes("NEGADA")) return "Solicitação negada pela regulação";
  if (st.includes("REENVIADA")) return "Reenviada para análise da regulação";
  if (st.includes("CANCELADA")) return "Solicitação Cancelada";
  
  return statusRaw; 
};

const getSituacaoInfo = (statusTraduzido) => {
  const st = String(statusTraduzido).toUpperCase();

  if (st.includes("PENDENTE") || st.includes("AGUARDANDO")) {
    return { label: "PENDENTE", emoji: "🟡", classe: "alerta" };
  }
  if (st.includes("AGENDADA") || st.includes("CONFIRMADA")) {
    return { label: "CONFIRMADO / AUTORIZADO", emoji: "🟢", classe: "sucesso" };
  }
  if (st.includes("NEGADA") || st.includes("CANCELADA") || st.includes("CANCELADO") || st.includes("NÃO ENCONTRADA")) {
    return { label: "NEGADO / CANCELADO", emoji: "🔴", classe: "perigo" };
  }
  if (st.includes("DEVOLVIDA") || st.includes("REENVIADA")) {
    return { label: "DEVOLVIDO / REENVIADO", emoji: "🔁", classe: "laranja" };
  }
  if (st.includes("FALTA") || st.includes("COMPARECEU")) {
    return { label: "FALTA / AUSÊNCIA", emoji: "⚠️", classe: "rosa" };
  }

  return { label: "NÃO DEFINIDO", emoji: "⚪", classe: "neutro" };
};

const LISTA_SITUACOES = [
  "🟡 PENDENTE",
  "🟢 CONFIRMADO / AUTORIZADO",
  "🔴 NEGADO / CANCELADO",
  "🔁 DEVOLVIDO / REENVIADO",
  "⚠️ FALTA / AUSÊNCIA"
];

const getNomeProcedimento = (src) => {
  if (!src) return "Procedimento não informado";

  const raw = src.no_procedimento || 
              src.nome_procedimento || 
              src.descricao_procedimento || 
              src.ds_procedimento || 
              src.procedimentos?.[0]?.descricao_interno || 
              src.procedimentos?.[0]?.descricao_sigtap || 
              '';

  if (!raw) return "Procedimento não informado";

  const padroesGenericos = [
      /CONSULTA\s*M[ÉE]DICA\s*EM\s*ATEN[CÇ][ÃA]O\s*ESPECIALIZADA/i,
      /ATENDIMENTO\s*DE\s*URG[ÊE]NCIA/i,
      /ATEN[CÇ][ÃA]O\s*B[ÁA]SICA/i,
      /ATEN[CÇ][ÃA]O\s*PRIM[ÁA]RIA/i
  ];

  const ehGenerico = padroesGenericos.some(regex => regex.test(String(raw)));

  if (ehGenerico) {
      
      if (src.descricao_interna_procedimento) {
          return src.descricao_interna_procedimento.trim();
      }

      if (src.procedimentos && Array.isArray(src.procedimentos)) {
          for (const item of src.procedimentos) {
              const nomeItem = item.descricao_interno || item.descricao_sigtap || item.nome_procedimento;
              
              if (nomeItem && !padroesGenericos.some(r => r.test(String(nomeItem)))) {
                  return nomeItem.trim();
              }
          }
      }

      if (src.nome_grupo_procedimento) {
          return src.nome_grupo_procedimento.trim();
      }
  }
  
  return String(raw).replace(/\s+/g, ' ').trim();
};

function App() {
  const [cpf, setCpf] = useState('')
  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  const [confirmado, setConfirmado] = useState(false);
  const [termoAceito, setTermoAceito] = useState(false);

  const [nomeMae, setNomeMae] = useState('')
  const [solicitandoValidacao, setSolicitandoValidacao] = useState(false)

  const [captchaGerado, setCaptchaGerado] = useState('');
  const [captchaDigitado, setCaptchaDigitado] = useState('');

  const gerarCaptcha = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let resultado = "";
    for (let i = 0; i < 6; i++) {
      resultado += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setCaptchaGerado(resultado);
    setCaptchaDigitado(""); 
  };

  useEffect(() => {
    gerarCaptcha();
  }, []);

  const [filtroAno, setFiltroAno] = useState('TODOS')
  const [filtroStatus, setFiltroStatus] = useState('TODOS')
  const [filtroSituacao, setFiltroSituacao] = useState('TODOS')
  const [ordem, setOrdem] = useState('PROCEDIMENTO')
  const [paginaAtual, setPaginaAtual] = useState(1);

  const limparDadosAnteriores = () => {
    setPedidos([]);
    setConfirmado(false);
    setTermoAceito(false);
    setErro('');
    setSolicitandoValidacao(false);
    setNomeMae('');
  };

  const buscarDados = async (e) => {
    e.preventDefault()
    
    if (!cpf.trim()) {
      limparDadosAnteriores();
      setErro('Por favor, digite o CPF do paciente.')
      return
    }

    if (!captchaDigitado.trim()) {
        limparDadosAnteriores();
        setErro('Por favor, digite o código de verificação exibido na caixa cinza.');
        return;
    }

    if (captchaDigitado.toUpperCase() !== captchaGerado) {
      limparDadosAnteriores();
      setErro('O código digitado não confere com a imagem. Tente novamente.');
      gerarCaptcha(); 
      return;
    }

    setLoading(true)
    setErro('')
    setPedidos([])
    setConfirmado(false)
    setTermoAceito(false)
    setSolicitandoValidacao(false)
    setNomeMae('')
    setFiltroAno('TODOS')
    setFiltroStatus('TODOS')
    setFiltroSituacao('TODOS')
    setPaginaAtual(1)

    try {
      const response = await axios.get(`http://localhost:8000/api/consulta/${cpf}`)
      
      if (response.data.status === 'aguardando_validacao') {
        setSolicitandoValidacao(true);
      } 
      else if (Array.isArray(response.data) && response.data.length === 0) {
        setErro('Nenhuma solicitação encontrada para este CPF.')
      } 
      else {
        setPedidos(response.data)
      }
    } catch (error) {
      setErro('Erro ao conectar com o servidor.')
    } finally {
      setLoading(false)
    }
  }

  const validarMae = async () => {
    if (!nomeMae.trim()) {
      setErro('Digite o primeiro nome da mãe.');
      return;
    }
    setLoading(true);
    setErro('');

    try {
      const response = await axios.get(`http://localhost:8000/api/consulta/${cpf}`, {
        params: { nome_mae: nomeMae }
      });
      
      let dados = [];
      if (Array.isArray(response.data)) {
          dados = response.data;
      } else if (response.data.lista_exames && Array.isArray(response.data.lista_exames)) {
          dados = response.data.lista_exames;
      } else {
          dados = []; 
      }

      setPedidos(dados);
      setSolicitandoValidacao(false);
      setNomeMae('');
    } catch (error) {
      if (error.response && error.response.status === 403) {
        setErro('Nome da mãe incorreto. Verifique e tente novamente.');
      } else {
        setErro('Erro ao validar dados.');
      }
    } finally {
      setLoading(false);
    }
  }

  const cancelarConfirmacao = () => {
    limparDadosAnteriores();
    setCpf('');
    setCaptchaDigitado('');
    gerarCaptcha();
  }

  const ultimaAtualizacaoGeral = useMemo(() => {
    if (pedidos.length === 0) return null;
    let maxDate = 0;
    let dataFinal = null;
    pedidos.forEach(item => {
      const s = item._source || {};
      const datasPossiveis = [s.data_atualizacao, s.data_atualizacao_marcacao, s.data_atualizacao_solicitacao, s.dt_atualizacao];
      datasPossiveis.forEach(d => {
        if (d) {
          const timestamp = new Date(d).getTime();
          if (!isNaN(timestamp) && timestamp > maxDate) { maxDate = timestamp; dataFinal = d; }
        }
      });
    });
    return dataFinal;
  }, [pedidos]);

  const anosDisponiveis = useMemo(() => {
    const anos = pedidos.map(item => extrairAno(item._source?.data_solicitacao)).filter(a => a && a.length === 4);
    return [...new Set(anos)].sort((a,b) => b - a);
  }, [pedidos]);

  const listaExibida = useMemo(() => {
    let lista = [...pedidos];
    if (filtroAno !== 'TODOS') lista = lista.filter(item => extrairAno(item._source?.data_solicitacao) === filtroAno);
    if (filtroStatus !== 'TODOS') lista = lista.filter(item => traduzirStatus(item._source?.status_solicitacao) === filtroStatus);
    if (filtroSituacao !== 'TODOS') lista = lista.filter(item => {
        const traduzido = traduzirStatus(item._source?.status_solicitacao);
        const info = getSituacaoInfo(traduzido);
        return `${info.emoji} ${info.label}` === filtroSituacao;
    });
    
    lista.sort((a, b) => {
      const sourceA = a._source || {}; const sourceB = b._source || {};
      
      if (ordem === 'PROCEDIMENTO') {
          return String(getNomeProcedimento(sourceA)).localeCompare(String(getNomeProcedimento(sourceB)));
      }

      if (ordem === 'DATA_DESC') return new Date(sourceB.data_solicitacao || 0) - new Date(sourceA.data_solicitacao || 0);
      if (ordem === 'DATA_ASC') return new Date(sourceA.data_solicitacao || 0) - new Date(sourceB.data_solicitacao || 0);
      if (ordem === 'UNIDADE') return String(sourceA.nome_unidade_solicitante || "").localeCompare(String(sourceB.nome_unidade_solicitante || ""));
      if (ordem === 'STATUS') return String(traduzirStatus(sourceA.status_solicitacao)).localeCompare(String(traduzirStatus(sourceB.status_solicitacao)));
      return 0;
    });
    return lista;
  }, [pedidos, filtroAno, filtroSituacao, filtroStatus, ordem]);

  useEffect(() => { setPaginaAtual(1); }, [listaExibida]);

  const indexUltimoItem = paginaAtual * ITENS_POR_PAGINA;
  const indexPrimeiroItem = indexUltimoItem - ITENS_POR_PAGINA;
  const itensAtuais = listaExibida.slice(indexPrimeiroItem, indexUltimoItem);
  const totalPaginas = Math.ceil(listaExibida.length / ITENS_POR_PAGINA);

  const mudarPagina = (n) => {
    setPaginaAtual(n);
    const el = document.querySelector('.filters-container');
    if(el) el.scrollIntoView({ behavior: 'smooth' });
  };

  const primeiroPedido = pedidos.length > 0 ? pedidos[0]._source : null;

  return (
    <div className="app-container">
      <header className="app-header">
        <img src={logoPrefeitura} alt="Prefeitura" className="header-logo" />
        <h1 className="app-title">PORTAL DA TRANSPARÊNCIA<br />CENTRAL DE REGULAÇÃO</h1>
        <p className="app-description">
          Digite seu CPF abaixo e se informe sobre a situação atualizada dos seus agendamentos, exames e consultas.
        </p>
      </header>
      
      <div className="search-container">
            <form onSubmit={buscarDados} className="search-form">
            <div className="inputs-wrapper">
                <input
                type="text"
                placeholder="Digite o CPF do paciente"
                value={cpf}
                onChange={(e) => {
                    setCpf(e.target.value);
                    setCaptchaDigitado('');
                    if (pedidos.length > 0 || erro) {
                        limparDadosAnteriores();
                        gerarCaptcha();
                    }
                }}
                className="search-input cpf-input"
                />
                <div className="captcha-wrapper">
                <div className="captcha-box" title="Código de verificação">{captchaGerado}</div>
                <button type="button" className="captcha-refresh-btn" onClick={gerarCaptcha} title="Trocar código">↻</button>
                <input type="text" placeholder="Digite aqui o código visualizado" value={captchaDigitado}
                    onChange={(e) => setCaptchaDigitado(e.target.value)} className="search-input captcha-input"
                />
                </div>
            </div>
            <button type="submit" disabled={loading} className="search-button">
                {loading ? '...' : 'CONSULTAR'}
            </button>
            </form>
      </div>

      {!solicitandoValidacao && erro && <div className="error-message">{erro}</div>}

      {solicitandoValidacao && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <h3>Segurança Adicional</h3>
            </div>
            <div className="modal-body">
              <p>Para proteger seus dados, confirme o <strong>primeiro nome da sua mãe</strong>:</p>
              
              <input 
                type="text" 
                className="search-input input-mae-centralizado" 
                placeholder="Ex: Maria"
                value={nomeMae}
                onChange={(e) => {
                    setNomeMae(e.target.value);
                    setErro('');
                }}
                onFocus={() => setErro('')}
              />

              {erro && <div className="error-msg-modal">{erro}</div>}

              <div className="modal-actions">
                <button className="btn-cancelar" onClick={cancelarConfirmacao}>Cancelar</button>
                <button className="btn-confirmar" onClick={validarMae} disabled={loading}>
                  {loading ? 'Verificando...' : 'Verificar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pedidos.length > 0 && !confirmado && !solicitandoValidacao && primeiroPedido && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header"><h3>Confirmação de Identidade</h3></div>
            <div className="modal-body">
              <p style={{marginBottom: '15px', topBottom: '15px', fontSize: '1rem'}}>Para proteger seus dados, confirme se as informações abaixo correspondem a você:</p>
              
              <div className="modal-info">
                  <div className="info-item">
                      <strong>PACIENTE:</strong>
                      <span>{gerarIniciais(primeiroPedido.no_usuario)}</span>
                  </div>
                  <div className="info-item">
                      <strong>NASCIMENTO:</strong>
                      <span>{formatarData(primeiroPedido.dt_nascimento_usuario)}</span>
                  </div>
                  <div className="info-item">
                      <strong>CPF:</strong>
                      <span>{formatarCPF(cpf)}</span>
                  </div>
                  <div className="info-item">
                      <strong>ENDEREÇO:</strong>
                      <span>{primeiroPedido.endereco_completo}</span>
                  </div>
                  <div className="info-item">
                      <strong>TELEFONE:</strong>
                      <span>{primeiroPedido.telefone_unificado}</span>
                  </div>
              </div>

              <div className="aviso-vermelho">
                  * Verifique se seu endereço e telefone estão corretos. Caso contrário, entre em contato com sua Unidade de Saúde para atualização cadastral.
              </div>

              <div className="terms-container">
                <label className="terms-label">
                  <input type="checkbox" checked={termoAceito} onChange={(e) => setTermoAceito(e.target.checked)} className="terms-checkbox"/>
                  Declaro que sou o titular dos dados ou seu representante legal.
                </label>
              </div>
              
              <div className="modal-actions">
                <button className="btn-cancelar" onClick={cancelarConfirmacao}>NÃO SOU EU</button>
                <button className="btn-confirmar" onClick={() => setConfirmado(true)} disabled={!termoAceito}>SIM, CONFIRMAR</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pedidos.length > 0 && confirmado && primeiroPedido && (
        <>
          <div className="patient-header">
             <h2>Procedimentos do Paciente {gerarIniciais(primeiroPedido.no_usuario)}</h2>
             <p className="patient-dob">Nascimento: {formatarData(primeiroPedido.dt_nascimento_usuario)}</p>
             {ultimaAtualizacaoGeral && <div className="last-update-banner">Sistema atualizado no dia <strong>{formatarData(ultimaAtualizacaoGeral)}</strong></div>}
          </div>

          <div className="filters-container">
            <div className="filters-row">
              <div className="filter-group">
                <select 
                  className={`filter-select ${filtroAno !== 'TODOS' ? 'active-filter' : ''}`} 
                  value={filtroAno} 
                  onChange={(e) => setFiltroAno(e.target.value)}
                >
                  <option value="TODOS">Todos os Anos</option>
                  {anosDisponiveis.map(ano => (<option key={ano} value={ano}>{ano}</option>))}
                </select>

                <select 
                  className={`filter-select ${filtroSituacao !== 'TODOS' ? 'active-filter' : ''}`} 
                  value={filtroSituacao} 
                  onChange={(e) => setFiltroSituacao(e.target.value)}
                >
                  <option value="TODOS">Todas as Situações</option>
                  {LISTA_SITUACOES.map(s => (<option key={s} value={s}>{s}</option>))}
                </select>
              </div>
              
              <select className="sort-select" value={ordem} onChange={(e) => setOrdem(e.target.value)}>
                <option value="PROCEDIMENTO">Procedimento (A-Z)</option>
                <option value="DATA_DESC">Data da Solicitação (Mais Recente)</option>
                <option value="DATA_ASC">Data da Solicitação (Mais Antiga)</option>
                <option value="UNIDADE">Unidade Solicitante (A-Z)</option>
                <option value="STATUS">Situação (A-Z)</option>
              </select>
              
              <div className="results-count">Mostrando <strong>{listaExibida.length}</strong> de {pedidos.length} registros</div>
            </div>

            <div className="legends-wrapper">
              <div className="legend-section">
                <span className="legend-title">Legenda de Situação</span>
                <div className="legend-grid">
                  <div className="legend-item"><div className="legend-header"><span className="legend-dot ind-alerta"></span>🟡 PENDENTE</div></div>
                  <div className="legend-item"><div className="legend-header"><span className="legend-dot ind-sucesso"></span>🟢 CONFIRMADO / AUTORIZADO</div></div>
                  <div className="legend-item"><div className="legend-header"><span className="legend-dot ind-perigo"></span>🔴 NEGADO / CANCELADO</div></div>
                  <div className="legend-item"><div className="legend-header"><span className="legend-dot ind-laranja"></span>🔁 DEVOLVIDO / REENVIADO</div></div>
                  <div className="legend-item"><div className="legend-header"><span className="legend-dot ind-rosa"></span>⚠️ FALTA / AUSÊNCIA</div></div>
                </div>
              </div>
            </div>
          </div>

          <div className="results-container">
            {itensAtuais.map((item, index) => {
              const source = item._source || {};
              
              const nomeProcedimento = getNomeProcedimento(source);
              
              const solicitante = source.nome_unidade_solicitante || 'Não informado';
              const statusTraduzido = traduzirStatus(source.status_solicitacao);
              const situacaoInfo = getSituacaoInfo(statusTraduzido);

              return (
                <div key={index} className={`result-card tipo-${situacaoInfo.classe}`}>
                  <h3 className="card-title">{nomeProcedimento}</h3>
                  <div className="card-details">
                    <div className="info-row">
                      <strong>DATA DA SOLICITAÇÃO:</strong> {formatarData(source.data_solicitacao)}
                    </div>
                    
                    <div className="info-row">
                      <strong>UNIDADE SOLICITANTE:</strong> {solicitante}
                    </div>
                    
                    <div className="status-full">
                      <span className="emoji-grande">{situacaoInfo.emoji}</span>
                      <span className="status-texto">{statusTraduzido}</span>
                    </div>

                    {situacaoInfo.classe === 'sucesso' && (
                       <div className="destaque-contato">
                          <strong>AGENDAMENTO CONFIRMADO:</strong>
                          <span className="texto-contato" style={{marginBottom: '10px', display: 'block'}}>
                            Entre em contato com a Unidade Executante ou com a Central de Regulação para confirmar a data e o horário do seu agendamento.
                            Caso esteja tudo corretamente encaminhado, compareça com antecedência e leve seus documentos pessoais.
                          </span>
                          
                          <hr style={{border: '0', borderTop: '1px dashed #2ecc71', opacity: 0.6, margin: '10px 0'}}/>
                          
                          <div className="info-row" style={{marginBottom: '5px'}}>
                            <strong>DATA DO AGENDAMENTO:</strong> {formatarDataHora(source.data_marcacao || source.data_atualizacao_marcacao)}
                          </div>
                          
                          <div className="info-row">
                            <strong>UNIDADE EXECUTANTE:</strong> {source.nome_unidade_executante || source.no_unidade_executante || 'Consulte a unidade solicitante'}
                          </div>
                       </div>
                    )}
                  </div>
                </div>
              );
            })}
            
            {listaExibida.length > ITENS_POR_PAGINA && (
              <div className="pagination-container">
                <button className="page-btn nav-btn" onClick={()=>setPaginaAtual(p=>p-1)} disabled={paginaAtual===1}>Anterior</button>
                {Array.from({length:totalPaginas},(_,i)=>(<button key={i} className={`page-btn ${paginaAtual===i+1?'active':''}`} onClick={()=>setPaginaAtual(i+1)}>{i+1}</button>))}
                <button className="page-btn nav-btn" onClick={()=>setPaginaAtual(p=>p+1)} disabled={paginaAtual===totalPaginas}>Próximo</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default App