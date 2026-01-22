import { useState } from 'react'
import axios from 'axios'
import './App.css'
import logoPrefeitura from './assets/logo-prefeitura.png'

function App() {
  const [cpf, setCpf] = useState('')
  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')

  const gerarIniciais = (nomeCompleto) => {
    if (!nomeCompleto) return 'Não informado';
    const partes = nomeCompleto.trim().split(' ');
    const iniciais = partes.map(parte => parte[0].toUpperCase() + '.');
    return iniciais.join(' ');
  }

  const formatarData = (dataString) => {
    if (!dataString) return '-';
    const partes = dataString.split('-');
    if (partes.length !== 3) return dataString;
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  }

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

      {erro && (
        <div className="error-message">
          {erro}
        </div>
      )}

      <div className="results-container">
        {pedidos.map((item, index) => (
          <div key={index} className="result-card">
            <h3 className="card-title">
              {item._source.descricao_procedimento || 'Procedimento não especificado'}
            </h3>
            
            <div className="card-grid">
              {}
              <p><strong>Paciente:</strong> {gerarIniciais(item._source.no_usuario)}</p>
              <p><strong>Nascimento:</strong> {formatarData(item._source.dt_nascimento_usuario)}</p>
              
              <p><strong>Data Solicitação:</strong> {formatarData(item._source.data_solicitacao)}</p>
              
              <p><strong>Status:</strong> <span className="status-highlight">{item._source.status_solicitacao}</span></p>
              
              <p><strong>Unidade:</strong> {item._source.nome_unidade_solicitante}</p>
              <p><strong>Classificação Risco:</strong> {item._source.classificacao_risco}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App