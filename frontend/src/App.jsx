import { useState, useMemo } from 'react'
import axios from 'axios'
import './App.css'
import logoPrefeitura from './assets/logo-prefeitura.png'

const gerarIniciais = (nomeCompleto) => {
  if (!nomeCompleto) return 'Não informado';
  const partes = nomeCompleto.trim().split(' ');
  return partes.map(parte => parte[0].toUpperCase() + '.').join(' ');
}

const extrairAno = (dataString) => {
  if (!dataString) return "";
  
  if (dataString.includes('-')) {
    return dataString.split('-')[0];
  }
  
  if (dataString.includes('/')) {
    const partes = dataString.split('/');
    if (partes.length === 3) return partes[2];
  }

  return dataString.substring(0, 4);
};

const formatarData = (dataISO) => {
  if (!dataISO) return "-";
  try {
    if (dataISO.includes('/')) return dataISO;
    const data = new Date(dataISO);
    if (isNaN(data.getTime())) return dataISO;
    return data.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  } catch (e) {
    return dataISO;
  }
};

const getStatusClass = (statusBruto) => {
  if (!statusBruto) return { texto: "Desconhecido", classe: "neutro" };
  const statusUpper = statusBruto.toUpperCase();
  
  if (statusUpper.includes("AGENDADO") || statusUpper.includes("AGENDADA") || statusUpper.includes("CONFIRMADO") || statusUpper.includes("AUTORIZADO")) {
    return { classe: "sucesso" };
  }
  if (statusUpper.includes("CANCELADO") || statusUpper.includes("NEGADO") || statusUpper.includes("DEVOLVIDO") || statusUpper.includes("FALTA")) {
    return { classe: "perigo" };
  }
  if (statusUpper.includes("PENDENTE") || statusUpper.includes("SOLICITAÇÃO") || statusUpper.includes("AGUARDANDO") || statusUpper.includes("CONFIRMAÇÃO") || statusUpper.includes("ANÁLISE")) {
    return { classe: "alerta" };
  }
  return { classe: "info" };
};

const getRiscoClass = (codigo) => {
  const cod = String(codigo);
  switch (cod) {
    case "1": return { texto: "EMERGÊNCIA", classe: "perigo" };
    case "2": return { texto: "URGÊNCIA", classe: "alerta" };
    case "3": return { texto: "NÃO URGENTE", classe: "sucesso" };
    case "4": return { texto: "ELETIVO", classe: "info" };
    default: return { texto: "NÃO CLASSIFICADO", classe: "neutro" };
  }
};

const RISCOS_PADRAO = ['1', '2', '3', '4'];

const STATUS_CATEGORIAS = [
  'AGENDADO/A',
  'AUTORIZADO/A',
  'CANCELADO/A',
  'CONFIRMADO/A',
  'DEVOLVIDO/A',
  'FALTA',
  'NÃO DEFINIDO',
  'NEGADO/A',
  'PENDENTE',
  'PENDENTE CONFIRMAÇÃO',
  'REENVIADO/A',
  'SOLICITAÇÃO INEXISTENTE'
];

const normalizarStatus = (statusRaw) => {
  if (!statusRaw) return 'NÃO DEFINIDO';
  const st = statusRaw.toUpperCase();

  if (st.includes('FALTA')) return 'FALTA';
  if (st.includes('INEXISTENTE')) return 'SOLICITAÇÃO INEXISTENTE';
  if (st.includes('CONFIRMAÇÃO') || st.includes('AGUARDANDO CONFIRMAÇÃO')) return 'PENDENTE CONFIRMAÇÃO';
  
  if (st.includes('CONFIRMADO') || st.includes('CONFIRMADA')) return 'CONFIRMADO/A';
  if (st.includes('REENVIADO') || st.includes('REENVIADA')) return 'REENVIADO/A';
  if (st.includes('DEVOLVIDO') || st.includes('DEVOLVIDA')) return 'DEVOLVIDO/A';
  if (st.includes('NEGADO') || st.includes('NEGADA')) return 'NEGADO/A';
  if (st.includes('CANCELADO') || st.includes('CANCELADA')) return 'CANCELADO/A';
  if (st.includes('AUTORIZADO') || st.includes('AUTORIZADA')) return 'AUTORIZADO/A';
  if (st.includes('AGENDADO') || st.includes('AGENDADA')) return 'AGENDADO/A';
  
  if (st.includes('PENDENTE') || st.includes('AGUARDANDO') || st.includes('ANÁLISE') || st.includes('SOLICITAÇÃO')) return 'PENDENTE';
  
  return 'NÃO DEFINIDO';
};

function App() {
  const [cpf, setCpf] = useState('')
  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')

  const [filtroAno, setFiltroAno] = useState('TODOS')
  const [filtroStatus, setFiltroStatus] = useState('TODOS')
  const [filtroRisco, setFiltroRisco] = useState('TODOS')
  const [ordem, setOrdem] = useState('DATA_DESC')

  const buscarDados = async (e) => {
    e.preventDefault()
    
    if (!cpf.trim()) {
      setErro('Por favor, insira o CPF no campo informado.')
      setPedidos([])
      return
    }

    setLoading(true)
    setErro('')
    setPedidos([])
    
    setFiltroAno('TODOS')
    setFiltroStatus('TODOS')
    setFiltroRisco('TODOS')

    try {
      const response = await axios.get(`http://localhost:8000/api/consulta/${cpf}`)
      if (response.data.length === 0) {
        setErro('Nenhuma solicitação encontrada para este CPF.')
      } else {
        setPedidos(response.data)
      }
    } catch (error) {
      console.error(error)
      setErro('Erro ao conectar com o servidor.')
    } finally {
      setLoading(false)
    }
  }

  const anosDisponiveis = useMemo(() => {
    const anosDoPaciente = pedidos.map(item => {
      const data = item._source?.data_solicitacao || "";
      return extrairAno(data);
    }).filter(ano => ano && !isNaN(ano) && ano.length === 4);

    return [...new Set(anosDoPaciente)].sort((a,b) => b - a);
  }, [pedidos]);

  const statusDisponiveis = useMemo(() => {
    return STATUS_CATEGORIAS.sort();
  }, []);

  const riscosDisponiveis = useMemo(() => {
    return RISCOS_PADRAO; 
  }, []);

  const listaExibida = useMemo(() => {
    let lista = [...pedidos];

    if (filtroAno !== 'TODOS') {
      lista = lista.filter(item => {
        const data = item._source?.data_solicitacao || "";
        const anoItem = extrairAno(data);
        return anoItem === filtroAno;
      });
    }

    if (filtroStatus !== 'TODOS') {
      lista = lista.filter(item => {
        const stRaw = (item._source?.status_solicitacao || "");
        const stNormalizado = normalizarStatus(stRaw);
        return stNormalizado === filtroStatus;
      });
    }

    if (filtroRisco !== 'TODOS') {
      lista = lista.filter(item => {
        const risco = String(item._source?.codigo_classificacao_risco || "0");
        return risco === filtroRisco;
      });
    }

    lista.sort((a, b) => {
      const sourceA = a._source || {};
      const sourceB = b._source || {};

      if (ordem === 'DATA_DESC') {
        return new Date(sourceB.data_solicitacao || 0) - new Date(sourceA.data_solicitacao || 0);
      }
      if (ordem === 'DATA_ASC') {
        return new Date(sourceA.data_solicitacao || 0) - new Date(sourceB.data_solicitacao || 0);
      }
      if (ordem === 'RISCO_PRIORIDADE') {
        const ra = parseInt(sourceA.codigo_classificacao_risco) || 9;
        const rb = parseInt(sourceB.codigo_classificacao_risco) || 9;
        return ra - rb;
      }
      if (ordem === 'STATUS') {
        return (sourceA.status_solicitacao || "").localeCompare(sourceB.status_solicitacao || "");
      }
      if (ordem === 'UNIDADE') {
        return (sourceA.nome_unidade_solicitante || "").localeCompare(sourceB.nome_unidade_solicitante || "");
      }
      return 0;
    });

    return lista;
  }, [pedidos, filtroAno, filtroStatus, filtroRisco, ordem]);

  const primeiroPedido = pedidos.length > 0 ? pedidos[0]._source : null;

  return (
    <div className="app-container">
      <header className="app-header">
        <img src={logoPrefeitura} alt="Prefeitura" className="header-logo" />
        <h1 className="app-title">PORTAL DA TRANSPARÊNCIA<br />CENTRAL DE REGULAÇÃO</h1>
        <p className="app-description">
          Consulte a situação dos seus agendamentos, exames e consultas.<br/>
          Digite seu CPF abaixo para obter informações atualizadas em tempo real.
        </p>
      </header>
      
      <div className="search-container">
        <form onSubmit={buscarDados} className="search-form">
          <input
            type="text"
            placeholder="Digite o CPF (somente números)"
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            className="search-input"
          />
          <button type="submit" disabled={loading} className="search-button">
            {loading ? '...' : 'CONSULTAR'}
          </button>
        </form>
      </div>

      {erro && <div className="error-message">{erro}</div>}

      {pedidos.length > 0 && primeiroPedido && (
        <div className="patient-header">
           <h2>Procedimentos do Paciente {gerarIniciais(primeiroPedido.no_usuario)}</h2>
           <p>Nascimento: {formatarData(primeiroPedido.dt_nascimento_usuario)}</p>
        </div>
      )}

      {pedidos.length > 0 && (
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
                className={`filter-select ${filtroRisco !== 'TODOS' ? 'active-filter' : ''}`}
                value={filtroRisco} 
                onChange={(e) => setFiltroRisco(e.target.value)}
              >
                <option value="TODOS">Todos os Riscos</option>
                {riscosDisponiveis.map(risco => (
                  <option key={risco} value={risco}>{getRiscoClass(risco).texto}</option>
                ))}
              </select>

              <select 
                className={`filter-select ${filtroStatus !== 'TODOS' ? 'active-filter' : ''}`}
                value={filtroStatus} 
                onChange={(e) => setFiltroStatus(e.target.value)}
              >
                <option value="TODOS">Todos os Status</option>
                {statusDisponiveis.map(st => (<option key={st} value={st}>{st}</option>))}
              </select>

            </div>
            
            <select className="sort-select" value={ordem} onChange={(e) => setOrdem(e.target.value)}>
              <option value="DATA_DESC">Data (Mais Recentes)</option>
              <option value="DATA_ASC">Data (Mais Antigos)</option>
              <option value="RISCO_PRIORIDADE">Risco (Maior Prioridade)</option>
              <option value="STATUS">Status (A-Z)</option>
              <option value="UNIDADE">Unidade (A-Z)</option>
            </select>
            
            <div className="results-count">Mostrando <strong>{listaExibida.length}</strong> de {pedidos.length} registros</div>
          </div>

          <div className="legends-wrapper">
            
            <div className="legend-section">
              <span className="legend-title">Legenda de Status</span>
              <div className="legend-grid">
                <div className="legend-item">
                  <div className="legend-header"><span className="legend-dot ind-sucesso"></span> VERDE</div>
                  <div>Agendado, Confirmado...</div>
                </div>
                <div className="legend-item">
                  <div className="legend-header"><span className="legend-dot ind-alerta"></span> AMARELO</div>
                  <div>Pendente, Aguardando...</div>
                </div>
                <div className="legend-item">
                  <div className="legend-header"><span className="legend-dot ind-perigo"></span> VERMELHO</div>
                  <div>Cancelado, Falta...</div>
                </div>
                <div className="legend-item">
                  <div className="legend-header"><span className="legend-dot ind-info"></span> AZUL</div>
                  <div>Eletivo, Outros...</div>
                </div>
              </div>
            </div>

            <div className="legend-section">
              <span className="legend-title">Legenda de Risco</span>
              <div className="legend-grid">
                <div className="legend-item">
                  <div className="legend-header"><span className="legend-dot ind-perigo"></span> VERMELHO</div>
                  <div>Emergência</div>
                </div>
                <div className="legend-item">
                  <div className="legend-header"><span className="legend-dot ind-alerta"></span> AMARELO</div>
                  <div>Urgência</div>
                </div>
                <div className="legend-item">
                  <div className="legend-header"><span className="legend-dot ind-sucesso"></span> VERDE</div>
                  <div>Não Urgente</div>
                </div>
                <div className="legend-item">
                  <div className="legend-header"><span className="legend-dot ind-info"></span> AZUL</div>
                  <div>Eletivo</div>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      <div className="results-container">
        {listaExibida.map((item, index) => {
          const source = item._source || {};
          
          let nomeProcedimento = 'Procedimento não especificado';
          if (source.procedimentos && Array.isArray(source.procedimentos) && source.procedimentos.length > 0) {
            nomeProcedimento = source.procedimentos[0].descricao_interno || source.procedimentos[0].descricao_sigtap || 'Procedimento sem nome';
          } else {
             nomeProcedimento = source.descricao_procedimento || source.no_procedimento || nomeProcedimento;
          }

          const solicitante = source.nome_unidade_solicitante || source.no_unidade_solicitante || 'Não informado';
          
          const statusRaw = source.status_solicitacao || "Sem status";
          const status = getStatusClass(statusRaw);
          const risco = getRiscoClass(source.codigo_classificacao_risco);

          return (
            <div key={index} className={`result-card tipo-${status.classe}`}>
              <h3 className="card-title">{nomeProcedimento}</h3>
              <div className="card-details">
                <div className="info-row">
                  <strong>DATA DA SOLICITAÇÃO:</strong>
                  {formatarData(source.data_solicitacao)}
                </div>
                <div className="info-row">
                  <strong>UNIDADE SOLICITANTE:</strong>
                  {solicitante}
                </div>
                <div className="info-row">
                  <strong>RISCO:</strong>
                  <span className={`badge badge-${risco.classe}`}>
                    {risco.texto}
                  </span>
                </div>
                <div className="status-full">
                  <span className={`status-indicator ind-${status.classe}`}></span>
                  {statusRaw}
                </div>
              </div>
            </div>
          );
        })}
        {pedidos.length > 0 && listaExibida.length === 0 && (
          <p style={{textAlign: 'center', width: '100%', color: '#666', marginTop: '20px'}}>
            Nenhum registro encontrado para esta filtragem. Tente novamente mudando o filtro acima.
          </p>
        )}
      </div>
    </div>
  )
}

export default App