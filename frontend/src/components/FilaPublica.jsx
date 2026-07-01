import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';

const renderSkeleton = () => (
  <div className="grid-especialidades">
    {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
      <div key={i} className="skeleton-card card-fila-skeleton">
        <div className="skeleton-title w-80"></div>
        <div className="skeleton-line w-50"></div>
        <div className="skeleton-bottom-fila">
           <div className="skeleton-title skeleton-numero"></div>
           <div className="skeleton-line skeleton-texto-curto"></div>
        </div>
      </div>
    ))}
  </div>
);

export default function FilaPublica() {

  const dataAtualizacao = useMemo(() => {
    const hoje = new Date();
    const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
    
    return ontem.toLocaleDateString('pt-BR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric' 
    });
  }, []);

  const [filas, setFilas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    const buscarFilas = async () => {
      try {
        const resposta = await axios.get(`${API_BASE_URL}/filas-espera`);
        
        if (resposta.data.dados_fila.length === 0) {
           setErro("Erro de comunicação com o servidor. Tente novamente mais tarde.");
        } else {
           setFilas(resposta.data.dados_fila);
        }
      } catch (err) {
        setErro(err.message || 'Falha ao buscar os dados da fila.');
      } finally {
        setCarregando(false);
      }
    };

    buscarFilas();
  }, []);

  return (
    <div className="container-fila-publica">
      
      <header className="busca-header">
        <h2 className="busca-titulo">
          Painel de Filas de Espera por Especialidade
        </h2>
        <p className="busca-subtitulo">
          Acompanhe a quantidade de pacientes aguardando na fila de espera de agendamentos por especialidade no município.
        </p>
      </header>
        
      {carregando && renderSkeleton()}

      {erro && (
        <div className="error-message erro-centralizado">
          <p><strong>ERRO:</strong> {erro}</p>
        </div>
      )}

      {!carregando && !erro && filas.length > 0 && (
        <div className="grid-especialidades">
          {filas.map((item, index) => (
            <div key={index} className="card-especialidade">
              <h3 className="card-title-especialidade">{item.especialidade}</h3>
              <div className="dado-quantidade">
                <span className="numero-fila">{item.quantidade}</span>
                <span className="legenda-fila">
                  {item.quantidade === 1 ? 'paciente' : 'pacientes'}<br />aguardando
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!carregando && !erro && (
        <div className="data-atualizacao">
          Sistema atualizado no dia {dataAtualizacao}
        </div>
      )}

    </div>
  );
}