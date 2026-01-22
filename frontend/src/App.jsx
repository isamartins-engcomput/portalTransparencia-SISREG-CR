import { useState } from 'react'
import axios from 'axios'
import './App.css'
import logoPrefeitura from './assets/logo-prefeitura.png'

const gerarIniciais = (nomeCompleto) => {
  if (!nomeCompleto) return 'Não informado';
  const partes = nomeCompleto.trim().split(' ');
  return partes.map(parte => parte[0].toUpperCase() + '.').join(' ');
}

const formatarData = (dataISO) => {
  if (!dataISO) return "-";
  try {
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
  const partes = statusBruto.split('/');
  const textoLimpo = partes.length >= 2 ? partes[1].trim() : partes[0].trim();

  if (statusUpper.includes("AGENDADO") || statusUpper.includes("AUTORIZADA") || statusUpper.includes("AGENDADA") || statusUpper.includes("CONFIRMADO") || statusUpper.includes("AUTORIZADO")) {
    return { texto: textoLimpo, classe: "sucesso" }; // Verde
  }
  
  if (statusUpper.includes("CANCELADO") || statusUpper.includes("NEGADO") || statusUpper.includes("DEVOLVIDO") || statusUpper.includes("FALTA")) {
    return { texto: textoLimpo, classe: "perigo" }; // Vermelho
  }
  
  if (statusUpper.includes("PENDENTE") || statusUpper.includes("SOLICITAÇÃO") || statusUpper.includes("AGUARDANDO") || statusUpper.includes("CONFIRMAÇÃO")) {
    return { texto: textoLimpo, classe: "alerta" }; // Amarelo
  }
  
  return { texto: textoLimpo, classe: "info" }; // Azul
};
const getRiscoClass = (codigo) => {
  const cod = String(codigo);
  switch (cod) {
    case "1": return { texto: "EMERGÊNCIA", classe: "perigo" };
    case "2": return { texto: "URGÊNCIA", classe: "alerta" };
    case "3": return { texto: "NÃO URGENTE", classe: "sucesso" };
    case "4": return { texto: "ELETIVO", classe: "info" };
    default: return { texto: "Não classificado", classe: "neutro" };
  }
};

function App() {
  const [cpf, setCpf] = useState('')
  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')

  const buscarDados = async (e) => {
    e.preventDefault()
    setLoading(true)
    setErro('')
    setPedidos([])

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

  return (
    <div className="app-container">
      
      <header className="app-header">
        <img src={logoPrefeitura} alt="Prefeitura de Três Lagoas" className="header-logo" />
        <h1 className="app-title">
          PORTAL DA TRANSPARÊNCIA <br />
          CENTRAL DE REGULAÇÃO
        </h1>
        <p className="app-description">
          Consulte a situação dos seus agendamentos, exames e consultas.<br />
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
          <button 
            type="submit" 
            disabled={loading}
            className="search-button"
          >
            {loading ? 'Aguarde...' : 'CONSULTAR'}
          </button>
        </form>
      </div>

      {erro && <div className="error-message">{erro}</div>}

      <div className="results-container">
        {pedidos.map((item, index) => {
          const source = item._source || {};
          
          let nomeProcedimento = 'Procedimento não especificado';
          if (source.procedimentos && Array.isArray(source.procedimentos) && source.procedimentos.length > 0) {
            nomeProcedimento = source.procedimentos[0].descricao_interno || 
                               source.procedimentos[0].descricao_sigtap || 
                               source.procedimentos[0].nome_procedimento ||
                               'Procedimento sem nome';
          } else {
             nomeProcedimento = source.descricao_procedimento || source.no_procedimento || source.nm_procedimento || nomeProcedimento;
          }

          const nomeUnidade = source.nome_unidade_solicitante || 
                              source.no_unidade_solicitante || 
                              source.nm_unidade_solicitante || 
                              source.unidade || 
                              source.descricao_unidade || 
                              'Unidade não informada';

          const status = getStatusClass(source.status_solicitacao);
          const risco = getRiscoClass(source.codigo_classificacao_risco || source.classificacao_risco);

          return (
            <div key={index} className={`result-card tipo-${status.classe}`}>
              
              <h3 className="card-title">{nomeProcedimento}</h3>
              
              <div className="card-grid">
                
                {/* LINHA 1 */}
                <div className="info-item">
                  <strong>PACIENTE:</strong>
                  {gerarIniciais(source.no_usuario)}
                </div>
                
                <div className="info-item">
                  <strong>NASCIMENTO:</strong>
                  {formatarData(source.dt_nascimento_usuario)}
                </div>

                {/* LINHA 2 */}
                <div className="info-item">
                  <strong>SOLICITADO:</strong>
                  {formatarData(source.data_solicitacao)}
                </div>

                <div className="info-item">
                  <strong>STATUS:</strong>
                  <span className={`badge badge-${status.classe}`}>
                    {status.texto}
                  </span>
                </div>

                {/* LINHA 3 */}
                <div className="info-item">
                  <strong>UNIDADE:</strong>
                  {nomeUnidade}
                </div>
                
                <div className="info-item">
                  <strong>RISCO:</strong>
                  <span className={`badge badge-${risco.classe}`}>
                    {risco.texto}
                  </span>
                </div>

              </div>
            </div>
          );
        })}
      </div>
    </div>
  )
}

export default App