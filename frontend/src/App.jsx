import { useState, useMemo, useEffect, useRef } from 'react'
import axios from 'axios'
import './App.css'
import logoPrefeitura from './assets/logo-prefeitura.png'
import FilaPublica from './components/FilaPublica.jsx'
import Faltometro from './components/Faltometro.jsx'

const ITENS_POR_PAGINA = 5;

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

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

const isDataFutura = (dataISO) => {
  if (!dataISO) return false;
  try {
    const dataAgendamento = new Date(dataISO);
    const agora = new Date();
    return dataAgendamento > agora;
  } catch (e) {
    return false;
  }
};

const formatarTelefone = (tel) => {
  if (!tel) return '';
  
  const partes = String(tel).split('/');
  
  const formatarParte = (parte) => {
    const limpo = parte.replace(/\D/g, '');
    
    if (limpo.length === 11) return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 7)}-${limpo.slice(7)}`;
    if (limpo.length === 10) return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 6)}-${limpo.slice(6)}`;
    if (limpo.length === 9) return `${limpo.slice(0, 5)}-${limpo.slice(5)}`;
    if (limpo.length === 8) return `(67) ${limpo.slice(0, 4)}-${limpo.slice(4)}`;
    
    return parte.trim();
  };
  
  return partes.map(p => formatarParte(p)).join(' / ');
};

const obterNumeroLink = (tel) => {
  if (!tel) return '';
  
  const limpo = String(tel).split('/')[0].replace(/\D/g, '');
  
  if (limpo.length === 8 || limpo.length === 9) {
    return `067${limpo}`;
  }
  
  if (limpo.length === 10 || limpo.length === 11) {
    return `0${limpo}`;
  }

  return limpo;
};

const mascararCPF = (cpf) => {
  const limpo = cpf.replace(/\D/g, '');
  return limpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.XXX.XXX-$4");
}

const renderSkeleton = () => (
    <div className="skeleton-container">
      {[1, 2, 3].map((i) => (
        <div key={i} className="skeleton-card">
          <div className="skeleton-title"></div>
          <div className="skeleton-line w-70"></div>
          <div className="skeleton-line w-50"></div>
          <div className="skeleton-line w-80"></div>
        </div>
      ))}
    </div>
  );

const extrairTextoLaudo = (laudo_obj) => {
  if (!laudo_obj) return "";
  
  if (typeof laudo_obj === 'string') return laudo_obj;
  
  if (Array.isArray(laudo_obj)) {
    return laudo_obj
      .map(l => l.observacao || l.descricao || l.justificativa || "")
      .filter(texto => texto && texto.trim() !== "")
      .join(" | ");
  }
  
  if (typeof laudo_obj === 'object') {
    return laudo_obj.observacao || laudo_obj.descricao || laudo_obj.justificativa || "";
  }
  
  return "";
};

const sanitizarMotivo = (textoRaw) => {
  if (!textoRaw) return "";

  let textoLimpo = String(textoRaw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/(?:negada|cancelada|devolvida)\s+dia.*?por\s+[\w_]+/ig, ' ')
    .replace(/\d{2}[./]\d{2}[./]\d{4}\s*-\s*\d{2}:\d{2}:\d{2}.*?(?=\s|-|$)/ig, ' ');

  textoLimpo = textoLimpo
    .replace(/[,;:]+\s*\./g, '.')
    .replace(/\.\s*,/g, '.')
    .replace(/\s+/g, ' ');

  let partes = textoLimpo.split(/[|/.;?!]+/);

  const blacklist = ["teste", "dsaodasodkasdok", "para teste", "apenas teste", "teste do sisreg", "ok", "cancelado para teste", "erro", "errado"];

  let partesValidas = partes.map(p => p.trim().toLowerCase()).filter(parte => {
    if (parte.length === 0) return false;
    if (/^\d+$/.test(parte)) return false;
    if (blacklist.includes(parte)) return false;

    if (!parte.includes(' ')) {
      if (/[bcdfghjklmnpqrstvwxz]{5,}/i.test(parte)) return false;
      
      if (parte.length > 25) return false;
    }

    return true;
  });

  if (partesValidas.length === 0) return "";

  let sentencasUnicas = [];
  for (let i = 0; i < partesValidas.length; i++) {
    let s1 = partesValidas[i];
    let isRedundant = false;
    for (let j = 0; j < partesValidas.length; j++) {
      if (i !== j) {
        let s2 = partesValidas[j];
        if (s2.includes(s1) && s2.length >= s1.length) {
          if (s1 === s2 && i > j) isRedundant = true;
          else if (s1 !== s2) isRedundant = true;
        }
      }
    }
    if (!isRedundant) sentencasUnicas.push(s1);
  }

  if (sentencasUnicas.length === 0) return "";

  let textoFinal = sentencasUnicas.map(frase => {
    return frase.charAt(0).toUpperCase() + frase.slice(1);
  }).join('. ');

  textoFinal = textoFinal.replace(/[.,\s]+$/, '') + ".";

  return textoFinal;
};

const PainelPosicaoFila = ({ procedimento, status, dataSolicitacao }) => {
  const [posicao, setPosicao] = useState(null);
  const [buscando, setBuscando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let timerId = null;

    const buscarPosicao = async () => {
      if (!isMounted) return;

      try {
        const res = await axios.get(`${API_BASE_URL}/posicao-fila`, {
          params: { procedimento, status, data_solic: dataSolicitacao }
        });
        
        if (isMounted) {
          setPosicao(res.data.posicao_fila);
          setBuscando(false);
          setSincronizando(false);
        }
      } catch (e) {
        if (isMounted) {
          if (e.response?.status === 503) {
            setBuscando(false);
            setSincronizando(true);
            if (timerId) clearTimeout(timerId);
            timerId = setTimeout(buscarPosicao, 5000);
          } else {
            setBuscando(false);
            setSincronizando(true);
          }
        }
      }
    };

    const tempoDeCarregamento = Math.floor(Math.random() * 1000) + 500;
    const initialTimer = setTimeout(() => {
      buscarPosicao();
    }, tempoDeCarregamento);

    return () => {
      isMounted = false;
      clearTimeout(initialTimer);
      if (timerId) clearTimeout(timerId);
    };
  }, [procedimento, status, dataSolicitacao]);

  if (buscando) {
    return (
      <div className="posicao-fila-container" style={{ padding: '20px' }}>
         <div className="box-carregando-fila">
           <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="icone-giratorio">
             <path d="M12 2v4"></path><path d="M12 18v4"></path><path d="M4.93 4.93l2.83 2.83"></path><path d="M16.24 16.24l2.83 2.83"></path><path d="M2 12h4"></path><path d="M18 12h4"></path><path d="M4.93 19.07l2.83-2.83"></path><path d="M16.24 7.76l2.83-2.83"></path>
           </svg>
           <span>Calculando posição exata na fila...</span>
         </div>
      </div>
    );
  }

  if (sincronizando || !posicao) {
    return (
      <div className="posicao-fila-container">
         <div className="aviso-fila-viva">
           <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="icone-aviso-fila">
             <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
             <path d="M12 9v4"></path>
             <path d="M12 17h.01"></path>
           </svg>
           <span>Não foi possível calcular a posição exata neste momento, mas fique tranquilo(a): sua solicitação segue ativa e em análise. O servidor está sincronizando as filas neste exato momento. Permaneça nesta tela e sua posição aparecerá automaticamente em instantes.</span>
         </div>
      </div>
    );
  }

  return (
    <div className="posicao-fila-container">
      <div className="posicao-destaque">
        <span className="posicao-numero">{posicao}º</span>
        <span className="posicao-texto">na fila de espera</span>
      </div>
      <div className="aviso-fila-viva">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="icone-aviso-fila" style={{ marginRight: '8px' }}>
           <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
           <path d="M12 9v4"></path>
           <path d="M12 17h.01"></path>
        </svg>
        <span>Esta fila é dinâmica e viva! Sua posição pode sofrer alterações devido à entrada de pacientes com classificações de risco diferentes.</span>
      </div>
    </div>
  );
};

const filtrarUltimos5Anos = (listaPedidos) => {
  const anoAtual = new Date().getFullYear();
  const anoLimite = anoAtual - 5; 

  return listaPedidos.filter(item => {
    const source = item._source || {};
    
    const dataReferencia = source.data_solicitacao || source.data_marcacao || source.data_atualizacao;
    const anoStr = extrairAno(dataReferencia);
    
    if (!anoStr) return true; 
    
    const ano = parseInt(anoStr, 10);
    
    if (ano >= anoLimite) return true;
    
    const statusTraduzido = traduzirStatus(source.status_solicitacao, source.tipo_registro);
    const situacao = getSituacaoInfo(statusTraduzido);
    
    if (situacao.label === "PENDENTE") return true;

    return false; 
  });
};

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

const traduzirStatus = (statusRaw, tipoRegistro = "AMBULATORIAL") => {
  if (!statusRaw) return "Solicitação não encontrada";
  const st = String(statusRaw).toUpperCase().trim();

  if (PLANILHA_STATUS[st]) return PLANILHA_STATUS[st];

  if (tipoRegistro === "HOSPITALAR") {
    if (st.includes("APROVADA")) return "Cirurgia Aprovada / Agendada";
    if (st.includes("NEGADA")) return "Solicitação de cirurgia negada";
    if (st.includes("CANCELADA")) return "Cirurgia Cancelada";
    if (st.includes("DEVOLVIDA")) return "Devolvida para ajustes médicos";
    if (st.includes("REENVIADA")) return "Reenviada para análise hospitalar";
    if (st.includes("TROCA")) return "Troca de procedimento solicitada";
    if (st.includes("PENDENTE")) return "Pendente de análise hospitalar";
  }

  if (st.includes("FALTA") || st.includes("COMPARECEU")) return "Paciente não compareceu";
  if (st.includes("CANCELAD") || st.includes("NEGAD")) return "Solicitação Cancelada";
  if (st.includes("DEVOLVID")) return "Devolvida pela regulação para correção";
  if (st.includes("REENVIAD") || st.includes("TROCA")) return "Reenviada para análise da regulação";

  if (st.includes("AGENDAMENT") || st.includes("AGENDAD") || st.includes("CONFIRMAD") || st.includes("AUTORIZAD") || st.includes("FINALIZAD")) {
     if (st.includes("PENDENTE")) return "Agendada pendente de confirmação";
     return "Agendada e Confirmada";
  }

  if (st.includes("PENDENTE") || st.includes("AGUARDANDO") || st.includes("ESPERA")) {
     if (st.includes("FILA")) return "Pendente de agendamento (Fila)";
     return "Pendente de análise da regulação";
  }

  return statusRaw; 
};

const getSituacaoInfo = (statusTraduzido) => {
  const st = String(statusTraduzido).toUpperCase();

  if (st.includes("AGENDADA") || st.includes("CONFIRMADA") || st.includes("AUTORIZADA") || st.includes("APROVADA")) {
    return { label: "CONFIRMADO / AUTORIZADO", emoji: "🟢", classe: "sucesso" };
  }
  if (st.includes("PENDENTE") || st.includes("AGUARDANDO") || st.includes("ESPERA")) {
    return { label: "PENDENTE", emoji: "🟡", classe: "alerta" };
  }
  if (st.includes("NEGADA") || st.includes("CANCELADA") || st.includes("CANCELADO") || st.includes("NÃO ENCONTRADA")) {
    return { label: "NEGADO / CANCELADO", emoji: "🔴", classe: "perigo" };
  }
  if (st.includes("DEVOLVIDA") || st.includes("REENVIADA") || st.includes("CORREÇÃO") || st.includes("TROCA")) {
    return { label: "DEVOLVIDO / REENVIADO", emoji: "🟠", classe: "laranja" };
  }
  if (st.includes("FALTA") || st.includes("COMPARECEU")) {
    return { label: "FALTA / AUSÊNCIA", emoji: "🟣", classe: "rosa" };
  }

  return { label: "NÃO DEFINIDO", emoji: "⚪", classe: "neutro" };
};

const LISTA_SITUACOES = [
  "🟡 PENDENTE",
  "🟢 CONFIRMADO / AUTORIZADO",
  "🔴 NEGADO / CANCELADO",
  "🟠 DEVOLVIDO / REENVIADO",
  "🟣 FALTA / AUSÊNCIA",
  "🔵 AGENDAMENTO FUTURO",
];

const IconeStatus = ({ tipo, className = "" }) => {
  const getCor = (t) => {
    switch (t) {
      case 'sucesso': return 'var(--cor-sucesso)';
      case 'alerta':  return 'var(--cor-alerta)';
      case 'perigo':  return 'var(--gov-red)';
      case 'laranja': return 'var(--cor-laranja)';
      case 'rosa':    return 'var(--cor-rosa)';
      case 'futuro':  return 'var(--cor-info)';
      case 'telefone':return 'currentColor';
      default:        return 'var(--text-main)';
    }
  };

  const props = {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: getCor(tipo),
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  };

  switch (tipo) {
    case 'sucesso': 
      return <svg {...props}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>;
    case 'alerta': 
      return <svg {...props}><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>;
    case 'perigo': 
      return <svg {...props}><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>;
    case 'laranja': 
      return <svg {...props}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>;
    case 'rosa':
      return (
        <svg {...props}>
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
          <path d="M12 9v4"></path>
          <path d="M12 17h.01"></path>
        </svg>
      );
    case 'futuro': 
      return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>;
    case 'telefone': 
      return <svg {...props}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>;
    default:
      return <svg {...props}><circle cx="12" cy="12" r="10"></circle></svg>;
  }
};

const getCoresEtiqueta = (classe) => {
    switch(classe) {
      case 'sucesso': return { bg: '#f0fdf4', border: '#bcf0da', text: '#15803d' };
      case 'alerta': return { bg: '#fefce8', border: '#fef08a', text: '#a16207' };
      case 'perigo': return { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' };
      case 'laranja': return { bg: '#fff7ed', border: '#fed7aa', text: '#c2410c' };
      case 'rosa': return { bg: '#fdf2f8', border: '#fbcfe8', text: '#be185d' };
      case 'futuro': return { bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8' };
      default: return { bg: '#f8fafc', border: '#e2e8f0', text: '#334155' };
    }
  };

const getNomeProcedimento = (src) => {
  if (!src) return "PROCEDIMENTO NÃO INFORMADO";

  if (src.tipo_registro === "HOSPITALAR") {
    const macro = src.nome_grupo_procedimento;
    const micro = src.descricao_interna_procedimento || src.descricao_procedimento || src.nome_procedimento;
    if (macro && micro && macro.trim().toUpperCase() !== micro.trim().toUpperCase()) {
      return `${macro.toUpperCase()} - ${micro.toUpperCase()}`;
    }
    return (micro || macro || "CIRURGIA NÃO DETALHADA").toUpperCase();
  }

  const formatarRetorno = (texto) => String(texto).replace(/\s+/g, ' ').trim().toUpperCase();
  const normalizar = (texto) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  let raw = src.descricao_interna_procedimento || src.nome_procedimento || src.descricao_procedimento || 
            src.procedimentos?.[0]?.descricao_sigtap || src.procedimentos?.[0]?.descricao_interna || 
            src.procedimentos?.[0]?.nome_procedimento || src.nome_grupo_procedimento || "";

  if (!raw || String(raw).trim() === "") return "PROCEDIMENTO NÃO INFORMADO";

  const limpo = formatarRetorno(raw);
  const normLimpo = normalizar(limpo);

  if (normLimpo.includes("atencao especializada") || normLimpo.includes("urgencia") || normLimpo.includes("atencao basica")) {
      
      const candidatos = [
        { tipo: 'grupo', valor: src.nome_grupo_procedimento },
        { tipo: 'direto', valor: src.descricao_interna_procedimento },
        { tipo: 'direto', valor: src.nome_procedimento },
        { tipo: 'direto', valor: src.descricao_procedimento }
      ];

      if (src.procedimentos && Array.isArray(src.procedimentos)) {
          src.procedimentos.forEach(p => {
              candidatos.push({ tipo: 'direto', valor: p.descricao_sigtap });
              candidatos.push({ tipo: 'direto', valor: p.descricao_interna });
              candidatos.push({ tipo: 'direto', valor: p.nome_procedimento });
          });
      }

      for (const candidato of candidatos) {
          if (!candidato.valor) continue;
          
          const textoGaveta = formatarRetorno(candidato.valor);
          const normGaveta = normalizar(textoGaveta);
          
          if (normGaveta && normGaveta !== normLimpo && !normGaveta.includes("atencao") && !normGaveta.includes("urgencia") && !normGaveta.includes("basica")) {
              if (candidato.tipo === 'grupo') return `CONSULTA ESPECIALIZADA EM ${textoGaveta}`;
              return textoGaveta;
          }
      }
      
      return "CONSULTA ESPECIALIZADA (ESPECIALIDADE NÃO INFORMADA PELO SISREG)";
  }
  
  if (src.procedimentos && Array.isArray(src.procedimentos) && src.procedimentos.length > 1) {
      let procedimentosAgrupados = [];
      for (const item of src.procedimentos) {
          const nomeItem = formatarRetorno(item.descricao_sigtap || item.descricao_interna || item.nome_procedimento || "");
          if (nomeItem && !normalizar(nomeItem).includes("atencao especializada") && !normalizar(nomeItem).includes("urgencia")) {
              procedimentosAgrupados.push(nomeItem);
          }
      }
      let unicos = [...new Set(procedimentosAgrupados)];
      if (unicos.length > 0) return unicos.join(' + ');
  }

  return limpo;
};

function App() {
  const [visaoAtual, setVisaoAtual] = useState(() => sessionStorage.getItem('@sisreg/visao') || 'consulta');
  const [cpf, setCpf] = useState('');
  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  const [confirmado, setConfirmado] = useState(false);
  const [termoAceito, setTermoAceito] = useState(false);

  const [nomeMae, setNomeMae] = useState('')
  const [solicitandoValidacao, setSolicitandoValidacao] = useState(false)

  const [captchaGerado, setCaptchaGerado] = useState('');
  const [captchaDigitado, setCaptchaDigitado] = useState('');

  const resultadosRef = useRef(null);

  useEffect(() => {
    if (confirmado && resultadosRef.current) {
      setTimeout(() => {
        resultadosRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100); 
    }
  }, [confirmado]);

  const gerarCaptcha = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
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

  useEffect(() => {
    sessionStorage.setItem('@sisreg/visao', visaoAtual);
  }, [visaoAtual]);

  const [filtroAno, setFiltroAno] = useState('TODOS')
  const [filtroStatus, setFiltroStatus] = useState('TODOS')
  const [filtroSituacao, setFiltroSituacao] = useState('TODOS')
  const [filtroTipo, setFiltroTipo] = useState('TODOS')
  const [ordem, setOrdem] = useState('PROCEDIMENTO')
  const [paginaAtual, setPaginaAtual] = useState(1);

  const ultimaAttRef = useRef(null);
  const primeiroAcessoRef = useRef(true);
  const radarAtivoRef = useRef(true);
  const nomeMaeValidadoRef = useRef('');

  useEffect(() => {
    radarAtivoRef.current = true;

    const checarAtualizacao = async () => {
      if (!radarAtivoRef.current) return;

      try {
        const resposta = await axios.get(`${API_BASE_URL}/status-snapshot`);
        const timestampAtual = resposta.data.ultima_atualizacao;
        
        if (timestampAtual !== null) {
          
          if (ultimaAttRef.current === null && !primeiroAcessoRef.current) {
            console.log("Varredura concluída! Atualizando os dados silenciosamente...");
            radarAtivoRef.current = false;
            
            const cpfAtual = cpf;
            const maeAtual = nomeMaeValidadoRef.current;
            
            if (cpfAtual) {
                axios.get(`${API_BASE_URL}/consulta/${cpfAtual.trim()}`, {
                    params: maeAtual ? { nome_mae: maeAtual } : {}
                }).then(res => {
                    let dadosNovos = Array.isArray(res.data) ? res.data : (res.data.lista_exames || []);
                    setPedidos(filtrarUltimos5Anos(dadosNovos)); 
                }).catch(e => console.log("Erro no refresh invisível", e));
            }
            return;
          }
          
          if (primeiroAcessoRef.current) {
            ultimaAttRef.current = timestampAtual;
            primeiroAcessoRef.current = false;
            console.log("Snapshot consolidado. Desligando o radar.");
            radarAtivoRef.current = false;
            return;
          }
        } 
        else {
          if (primeiroAcessoRef.current) {
            ultimaAttRef.current = null;
            primeiroAcessoRef.current = false;
            console.log("Servidor em fase de extração. Radar em prontidão...");
          }
        }
      } catch (erro) {
      }

      if (radarAtivoRef.current) {
        setTimeout(checarAtualizacao, 10000);
      }
    };

    checarAtualizacao();

    return () => {
      radarAtivoRef.current = false; 
    };
  }, []);

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
    setFiltroTipo('TODOS')
    setPaginaAtual(1)

    try {
      const response = await axios.get(`${API_BASE_URL}/consulta/${cpf.trim()}`, {
        timeout: 15000 
      });
      
      if (response.data.status === 'aguardando_validacao') {
        setSolicitandoValidacao(true);
      } 
      else if (Array.isArray(response.data) && response.data.length === 0) {
        setErro('Não encontramos nenhuma solicitação ou agendamento para este CPF.');
      } 
      else {
        const dadosFiltrados = filtrarUltimos5Anos(response.data);
        
        if (dadosFiltrados.length === 0) {
          setErro('Não encontramos nenhuma solicitação ativa para este CPF nos últimos 5 anos.');
        } else {
          setPedidos(dadosFiltrados);
        }
      }
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        setErro('O sistema do governo está demorando muito para responder. Por favor, tente novamente em alguns minutos.');
      } else if (!error.response) {
        setErro('Falha na ligação. Verifique a sua internet ou tente novamente mais tarde.');
      } else {
        setErro('Ocorreu um erro ao consultar os dados. Tente novamente.');
      }
    } finally {
      setLoading(false);
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
      const response = await axios.get(`${API_BASE_URL}/consulta/${cpf.trim()}`, {
        params: { nome_mae: nomeMae }
      });

      nomeMaeValidadoRef.current = nomeMae.trim();
      
      let dados = [];
      if (Array.isArray(response.data)) {
          dados = response.data;
      } else if (response.data.lista_exames && Array.isArray(response.data.lista_exames)) {
          dados = response.data.lista_exames;
      } else {
          dados = []; 
      }

      const dadosFiltrados = filtrarUltimos5Anos(dados);
      
      setPedidos(dadosFiltrados);
      
      if (dadosFiltrados.length === 0) {
          setErro('Não há solicitações ativas nos últimos 5 anos.');
      }
      
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
    
    const hoje = new Date();
    const dataOntem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
    
    const ano = dataOntem.getFullYear();
    const mes = String(dataOntem.getMonth() + 1).padStart(2, '0');
    const dia = String(dataOntem.getDate()).padStart(2, '0');
    
    return `${ano}-${mes}-${dia}`;
  }, [pedidos]);

  const anosDisponiveis = useMemo(() => {
    const anos = pedidos.map(item => extrairAno(item._source?.data_solicitacao)).filter(a => a && a.length === 4);
    return [...new Set(anos)].sort((a,b) => b - a);
  }, [pedidos]);

  const listaExibida = useMemo(() => {
    let lista = [...pedidos];
    if (filtroAno !== 'TODOS') lista = lista.filter(item => extrairAno(item._source?.data_solicitacao) === filtroAno);
    if (filtroStatus !== 'TODOS') lista = lista.filter(item => traduzirStatus(item._source?.status_solicitacao, item._source?.tipo_registro) === filtroStatus);
    
    if (filtroTipo === 'HOSPITALAR') {
      lista = lista.filter(item => item._source?.tipo_registro === 'HOSPITALAR');
    } else if (filtroTipo === 'AMBULATORIAL') {
      lista = lista.filter(item => item._source?.tipo_registro === 'AMBULATORIAL'); 
    }

    if (filtroSituacao !== 'TODOS') {
        lista = lista.filter(item => {
            const source = item._source || {};
            const traduzido = traduzirStatus(source.status_solicitacao, source.tipo_registro);
            const info = getSituacaoInfo(traduzido);
            const dataDoAgendamento = source.data_marcacao || source.data_atualizacao_marcacao;
            const ehFuturo = info.classe === 'sucesso' && isDataFutura(dataDoAgendamento);
            const filtroTextoPuro = filtroSituacao.replace(/^[^\w\s]+/g, '').trim();

            if (filtroTextoPuro === "AGENDAMENTO FUTURO") {
                return ehFuturo;
            }
            
            if (filtroTextoPuro === "CONFIRMADO / AUTORIZADO") {
                return info.label === filtroTextoPuro && !ehFuturo;
            }
            
            return info.label === filtroTextoPuro;
        });
    }
    
    lista.sort((a, b) => {
      const sourceA = a._source || {}; 
      const sourceB = b._source || {};
      
      const getDataValida = (src) => {
        const str = src.data_solicitacao || src.data_marcacao || src.data_atualizacao;
        if (!str) return 0;
        const tempo = new Date(str).getTime();
        return isNaN(tempo) ? 0 : tempo;
      };

      if (ordem === 'PROCEDIMENTO') {
          return String(getNomeProcedimento(sourceA)).localeCompare(String(getNomeProcedimento(sourceB)));
      }

      if (ordem === 'DATA_DESC') return getDataValida(sourceB) - getDataValida(sourceA);
      if (ordem === 'DATA_ASC') return getDataValida(sourceA) - getDataValida(sourceB);
      
      if (ordem === 'UNIDADE') return String(sourceA.nome_unidade_solicitante || "").localeCompare(String(sourceB.nome_unidade_solicitante || ""));
      if (ordem === 'STATUS') return String(traduzirStatus(sourceA.status_solicitacao, sourceA.tipo_registro)).localeCompare(String(traduzirStatus(sourceB.status_solicitacao, sourceB.tipo_registro)));
      return 0;
    });
    return lista;
  }, [pedidos, filtroAno, filtroSituacao, filtroStatus, filtroTipo, ordem]);

  useEffect(() => { setPaginaAtual(1); }, [listaExibida]);

  const indexUltimoItem = paginaAtual * ITENS_POR_PAGINA;
  const indexPrimeiroItem = indexUltimoItem - ITENS_POR_PAGINA;
  const itensAtuais = listaExibida.slice(indexPrimeiroItem, indexUltimoItem);
  const totalPaginas = Math.ceil(listaExibida.length / ITENS_POR_PAGINA);

  const primeiroPedido = pedidos.length > 0 ? pedidos[0]._source : null;

  return (
    <div className="app-container">
      
      <a 
        href="https://docs.google.com/document/d/1YJi1qKZjkwGr2k9H4HiqG0ALX0oSjmm97-NIhR1Cj6U/edit?usp=sharing" 
        target="_blank" 
        rel="noopener noreferrer"
        className="botao-ajuda-flutuante"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        <span>Como usar?</span>
      </a>

      <header className="app-header">
        <img src={logoPrefeitura} alt="Prefeitura" className="header-logo" />
        <h1 className="app-title">PORTAL DA TRANSPARÊNCIA<br />CENTRAL DE REGULAÇÃO</h1>

        <div className="nav-abas-container">
          
          <button 
            type="button" 
            className={`aba-nav ${visaoAtual === 'consulta' ? 'aba-ativa' : ''}`} 
            onClick={() => { 
              setVisaoAtual('consulta'); 
              cancelarConfirmacao();
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            Consulta Individual
          </button>
          
          <button 
            type="button" 
            className={`aba-nav ${visaoAtual === 'filas' ? 'aba-ativa' : ''}`} 
            onClick={() => { 
              setVisaoAtual('filas');
              cancelarConfirmacao();
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
            Painel de Filas
          </button>

          <button 
            type="button" 
            className={`aba-nav ${visaoAtual === 'faltometro' ? 'aba-ativa' : ''}`} 
            onClick={() => { 
              setVisaoAtual('faltometro');
              cancelarConfirmacao();
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
            Faltômetro Municipal
          </button>

        </div>
      </header>

      {visaoAtual === 'filas' ? (
        <FilaPublica />
      ) : visaoAtual === 'faltometro' ? (
        <Faltometro />
      ) : (
        <>
          <header className="busca-header">
            <h2 className="busca-titulo">Acompanhamento de Solicitações do Cidadão</h2>
            <p className="busca-subtitulo">Digite seu CPF abaixo e se informe sobre a situação atualizada dos seus agendamentos, exames e consultas.</p>
          </header>

      <div className="search-container">
            <form onSubmit={buscarDados} className="search-form">
            <div className="inputs-wrapper">
                <input
                  type="text"
                  placeholder="Digite o CPF do paciente"
                  value={cpf}
                  disabled={loading}
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
                  <div 
                    className="captcha-box" 
                    title="Código de verificação"
                  >
                    {captchaGerado}
                  </div>
                  <button type="button" className="captcha-refresh-btn" onClick={gerarCaptcha} title="Trocar código">↻</button>
                  <input 
                    type="text" 
                    placeholder="Digite aqui o código visualizado" 
                    value={captchaDigitado}
                    onChange={(e) => setCaptchaDigitado(e.target.value.replace(/\s/g, ''))} 
                    className="search-input captcha-input"
                />
              </div>
            </div>
            <button type="submit" disabled={loading} className="search-button">
                {loading ? '...' : 'CONSULTAR'}
            </button>
            </form>
      </div>

      {!solicitandoValidacao && erro && <div className="error-message">{erro}</div>}
      {loading && !solicitandoValidacao && renderSkeleton()}

      {solicitandoValidacao && (
        <div className="modal-overlay">
          <form 
            onSubmit={(e) => { 
              e.preventDefault();
              validarMae(); 
            }} 
            className="modal-box"
          >
            <div className="modal-header">
              <h3>Segurança Adicional</h3>
            </div>
            <div className="modal-body">
              <p>Para proteger seus dados, confirme o <strong>primeiro nome da sua mãe</strong>:</p>
              
              <input 
                type="text" 
                className="search-input input-mae-centralizado" 
                placeholder="Exemplo: Maria"
                value={nomeMae}
                onChange={(e) => {
                    setNomeMae(e.target.value);
                    setErro('');
                }}
                onFocus={() => setErro('')}
                autoFocus
              />

              {erro && <div className="error-msg-modal">{erro}</div>}

              <div className="modal-actions">
                <button type="button" className="btn-cancelar" onClick={cancelarConfirmacao}>Cancelar</button>
                <button type="submit" className="btn-confirmar" disabled={loading}>
                  {loading ? 'Verificando...' : 'Verificar'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {pedidos.length > 0 && !confirmado && !solicitandoValidacao && primeiroPedido && (
        <div className="modal-overlay">
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              if (termoAceito) setConfirmado(true);
            }}
            className="modal-box"
          >
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
                      <span>{mascararCPF(cpf)}</span>
                  </div>
                  <div className="info-item">
                      <strong>ENDEREÇO:</strong>
                      <span>{primeiroPedido.endereco_completo}</span>
                  </div>
                  <div className="info-item">
                      <strong>TELEFONE:</strong>
                      <span>{formatarTelefone(primeiroPedido.telefone_unificado)}</span>
                  </div>
              </div>

              <div className="aviso-vermelho">
                  * Verifique se seu endereço e telefone estão corretos. Caso contrário, entre em contato com sua Unidade de Saúde para atualização cadastral.
              </div>

              <div className="terms-container">
                <label className="terms-label">
                  <input type="checkbox" checked={termoAceito} onChange={(e) => setTermoAceito(e.target.checked)} className="terms-checkbox"/>
                  Declaro que sou o titular dos dados ou seu representative legal.
                </label>
              </div>
              
              <div className="modal-actions">
                <button type="button" className="btn-cancelar" onClick={cancelarConfirmacao}>NÃO SOU EU</button>
                <button type="submit" className="btn-confirmar" disabled={!termoAceito}>SIM, CONFIRMAR</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {pedidos.length > 0 && confirmado && primeiroPedido && (
        <div ref={resultadosRef} className="dashboard-resultados-container" style={{ scrollMarginTop: '20px' }}>
          <div className="patient-header">
             <h2>Procedimentos do Paciente {gerarIniciais(primeiroPedido.no_usuario)}</h2>
             <p className="patient-dob">Nascimento: {formatarData(primeiroPedido.dt_nascimento_usuario)}</p>
             {ultimaAtualizacaoGeral && <div className="last-update-banner">Sistema atualizado no dia <strong>{formatarData(ultimaAtualizacaoGeral)}</strong></div>}
          </div>

          <div className="filters-container">
            <div className="filters-row">
              <div className="filter-group">
                
                <select 
                  className={`filter-select ${filtroTipo !== 'TODOS' ? 'active-filter' : ''}`} 
                  value={filtroTipo} 
                  onChange={(e) => setFiltroTipo(e.target.value)}
                >
                  <option value="TODOS">Todos os Tipos</option>
                  <option value="AMBULATORIAL">Ambulatorial</option>
                  <option value="HOSPITALAR">Hospitalar</option>
                </select>

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
              
              <select 
                className="sort-select" 
                value={ordem} 
                onChange={(e) => setOrdem(e.target.value)}
              >
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
                <span className="legend-title">Legenda de Situação:</span>
                <div className="legend-grid">
                  <div className="legend-item"><div className="legend-header"><span className="legend-dot ind-alerta"></span><IconeStatus tipo="alerta" className="icone-legenda" /> PENDENTE</div></div>
                  <div className="legend-item"><div className="legend-header"><span className="legend-dot ind-sucesso"></span><IconeStatus tipo="sucesso" className="icone-legenda" /> CONFIRMADO / AUTORIZADO</div></div>
                  <div className="legend-item"><div className="legend-header"><span className="legend-dot ind-perigo"></span><IconeStatus tipo="perigo" className="icone-legenda" /> NEGADO / CANCELADO</div></div>
                  <div className="legend-item"><div className="legend-header"><span className="legend-dot ind-laranja"></span><IconeStatus tipo="laranja" className="icone-legenda" /> DEVOLVIDO / REENVIADO</div></div>
                  <div className="legend-item"><div className="legend-header"><span className="legend-dot ind-rosa"></span><IconeStatus tipo="rosa" className="icone-legenda" /> FALTA / AUSÊNCIA</div></div>
                  <div className="legend-item"><div className="legend-header"><span className="legend-dot ind-info"></span><IconeStatus tipo="futuro" className="icone-legenda" /> AGENDAMENTO FUTURO</div></div>
                </div>
              </div>
            </div>

          </div>

          <div className="results-container">

            {listaExibida.length === 0 ? (
              <div className="empty-state-box">
                <h3 className="empty-state-titulo">
                  Nenhum registro encontrado...
                </h3>
                
                <p className="empty-state-texto">
                  O paciente não possui agendamentos
                  {filtroTipo !== 'TODOS' && <span> em <strong>{filtroTipo}</strong></span>}
                  {filtroSituacao !== 'TODOS' && <span> com o status <strong>"{filtroSituacao.replace(/^[^\w\s]+/, '').trim()}"</strong></span>}
                  {filtroAno !== 'TODOS' && <span> no ano de <strong>{filtroAno}</strong></span>}.
                </p>
                
                <button 
                  onClick={() => { setFiltroSituacao('TODOS'); setFiltroAno('TODOS'); setFiltroTipo('TODOS'); }}
                  className="btn-limpar-filtros"
                >Limpar Filtros</button>
              </div>
            ) : (

            itensAtuais.map((item, index) => {
              const source = item._source || {};
              
              const nomeProcedimento = getNomeProcedimento(source);
              const solicitante = source.nome_unidade_solicitante || 'Não informado';
              const statusTraduzido = traduzirStatus(source.status_solicitacao, source.tipo_registro);
              const situacaoInfo = getSituacaoInfo(statusTraduzido);
              
              const textoBruto = extrairTextoLaudo(source.laudo) || source.justificativa_impedimento || "";
              const motivoCancelamento = sanitizarMotivo(textoBruto);

              const dataDoAgendamento = source.data_marcacao || source.data_atualizacao_marcacao;
              const ehAgendamentoFuturo = situacaoInfo.classe === 'sucesso' && isDataFutura(dataDoAgendamento);

              const classeCard = ehAgendamentoFuturo ? 'futuro' : situacaoInfo.classe;
              const emojiCard = ehAgendamentoFuturo ? '🔵' : situacaoInfo.emoji;
              const textoStatusCard = ehAgendamentoFuturo ? 'AGENDAMENTO FUTURO' : statusTraduzido;

              const corTema = ehAgendamentoFuturo ? '#3498db' : '#2ecc71';
              const bgTema = ehAgendamentoFuturo ? '#f4f9fd' : '#f0fdf4';
              const bordaTema = ehAgendamentoFuturo ? '#b6d4fe' : '#bcf0da';
              const corTextoDetalhes = ehAgendamentoFuturo ? corTema : '#666666';
              const codSolicitacao = source.codigo_solicitacao || "Não informado"; 
              const isHospitalar = source.tipo_registro === "HOSPITALAR";
              const coresEtiqueta = getCoresEtiqueta(classeCard);

              const statusUpper = String(source.status_solicitacao).toUpperCase();
              const deveMostrarFila = (
                  !isHospitalar &&
                  (statusUpper.includes("PENDENTE") || statusUpper.includes("ESPERA") || statusUpper.includes("AGUARDANDO")) &&
                  !statusUpper.includes("AGENDADA") && 
                  !statusUpper.includes("AGENDAMENTO") &&
                  !statusUpper.includes("CONFIRMAD") &&
                  !statusUpper.includes("AUTORIZAD")
              );

              return (
                <div key={source.codigo_solicitacao ? `${source.codigo_solicitacao}-${index}` : index} className={`result-card tipo-${classeCard}`}>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '15px', marginBottom: '25px' }}>
                    
                    <div>
                      <h3 className="card-title" style={{ margin: 0 }}>{nomeProcedimento}</h3>
                    </div>

                    <div style={{ height: '0px', overflow: 'visible', flexShrink: 0 }}>

                      <div style={{ position: 'relative',display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end', flexShrink: 0 }}>
                      
                        <div style={{
                          backgroundColor: coresEtiqueta.bg,
                          color: coresEtiqueta.text,
                          border: `1px solid ${coresEtiqueta.border}`,
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontSize: '14px',
                          fontWeight: '700',
                          textAlign: 'center',
                          width: '100%'
                        }}>
                          <span style={{ display: 'block', fontSize: '10px', fontWeight: 'bold', opacity: 0.8, marginBottom: '2px', textTransform: 'uppercase' }}>
                            Cód. Solicitação
                          </span>
                          {codSolicitacao}
                        </div>

                        {isHospitalar && (
                          <div style={{
                            backgroundColor: coresEtiqueta.bg,
                            color: coresEtiqueta.text,
                            border: `1px solid ${coresEtiqueta.border}`,
                            padding: '4px 12px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: '800',
                            textAlign: 'center',
                            textTransform: 'uppercase',
                            width: '100%',
                            boxSizing: 'border-box'
                          }}>
                            <strong>HOSPITALAR</strong>
                          </div>
                        )}

                      </div>
                    </div>
                  </div>

                  <div className="card-details">
                    <div className="info-row">
                      <strong>DATA DA SOLICITAÇÃO:</strong> {formatarData(source.data_solicitacao)}
                    </div>

                    {isHospitalar && source.data_reserva && (
                      <div className="info-row">
                        <strong>DATA DA CIRURGIA:</strong> {formatarData(source.data_reserva)}
                      </div>
                    )}
                    
                    <div className="info-row">
                      <strong>UNIDADE SOLICITANTE:</strong> {solicitante}
                    </div>
                    
                    <div className="status-full">
                      <span className="icone-status-card">
                        <IconeStatus tipo={classeCard} />
                      </span>
                      <span className="status-texto" style={ehAgendamentoFuturo ? { color: '#3498db', fontWeight: 'bold' } : {}}>
                        {textoStatusCard}
                      </span>
                    </div>

                    {deveMostrarFila && source.posicao_fila_calculada && (
                      <div className="posicao-fila-container">
                        <div className="posicao-destaque">
                          <span className="posicao-numero">{source.posicao_fila_calculada}º</span>
                          <span className="posicao-texto">na fila de espera</span>
                        </div>
                        <div className="aviso-fila-viva">
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="icone-aviso-fila" style={{ marginRight: '8px' }}>
                            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
                            <path d="M12 9v4"></path>
                            <path d="M12 17h.01"></path>
                          </svg>
                          <span>Esta fila é dinâmica e viva! Sua posição pode sofrer alterações devido à entrada de pacientes com classificações de risco diferentes.</span>
                        </div>
                      </div>
                    )}

                    {deveMostrarFila && !source.posicao_fila_calculada && nomeProcedimento && source.data_solicitacao && (
                        <PainelPosicaoFila 
                          procedimento={nomeProcedimento} 
                          status={source.status_solicitacao} 
                          dataSolicitacao={source.data_solicitacao} 
                        />
                    )}

                    {(situacaoInfo.classe === 'sucesso' || classeCard === 'futuro') && (
                       <div className="destaque-contato" style={{ backgroundColor: bgTema, border: `1px solid ${bordaTema}`, borderRadius: '6px', padding: '12px', marginTop: '12px' }}>
                          
                          <strong style={{ color: ehAgendamentoFuturo ? corTema : '#666666', display: 'block', marginBottom: '4px' }}>
                            {ehAgendamentoFuturo ? 'INSTRUÇÕES PARA O ATENDIMENTO' : 'DETALHES DO ANTIGO AGENDAMENTO'}
                          </strong>

                          {ehAgendamentoFuturo && (
                            <span className="texto-contato" style={{marginBottom: '10px', display: 'block', color: '#333'}}>
                              Entre em contato com a Unidade Executante para confirmar a data e o horário do seu agendamento.
                              Caso esteja tudo corretamente encaminhado, compareça com antecedência e leve seus documentos pessoais.
                            </span>
                          )}
                          
                          <hr style={{border: '0', borderTop: `1px dashed ${corTema}`, opacity: 0.6, margin: '10px 0'}}/>
                          
                          <div className="info-row" style={{marginBottom: '5px', color: ehAgendamentoFuturo ? 'inherit' : '#666666'}}>
                            <strong style={{ color: corTextoDetalhes }}>DATA E HORÁRIO:</strong> {formatarDataHora(dataDoAgendamento)}
                          </div>
                          
                          <div className="info-row" style={{color: ehAgendamentoFuturo ? 'inherit' : '#666666'}}>
                            <strong style={{ color: corTextoDetalhes }}>UNIDADE EXECUTANTE:</strong> {source.nome_unidade_executante || 'Consulte a unidade solicitante.'}
                          </div>

                          {source.telefone_unidade_executante && (
                            <div className="info-row" style={{marginTop: '5px', color: ehAgendamentoFuturo ? 'inherit' : '#666666'}}>
                              <strong style={{ color: corTextoDetalhes }}>TELEFONE:</strong>{' '}
                              <a 
                                href={`tel:${obterNumeroLink(source.telefone_unidade_executante)}`} 
                                className="link-telefone"
                                style={{ color: corTextoDetalhes, textDecoration: 'underline', fontWeight: 'bold', marginLeft: '5px' }}
                                title="Clique para ligar"
                              >
                                <IconeStatus tipo="telefone" className="icone-telefone" /> {formatarTelefone(source.telefone_unidade_executante)}
                              </a>
                            </div>
                          )}
                       </div>
                    )}

                    {situacaoInfo.classe === 'perigo' && motivoCancelamento && (
                      <div className="box-motivo box-motivo-perigo">
                        <strong className="titulo-motivo-perigo">MOTIVO DO CANCELAMENTO OU NEGATIVA:</strong>
                        <span className="texto-motivo">{motivoCancelamento}</span>
                     </div>
                    )}

                    {situacaoInfo.classe === 'laranja' && motivoCancelamento && (
                      <div className="box-motivo box-motivo-laranja">
                        <strong className="titulo-motivo-laranja">MOTIVO DA DEVOLUÇÃO (PENDENTE DE CORREÇÃO):</strong>
                        <span className="texto-motivo">{motivoCancelamento}</span>
                     </div>
                    )}
                    
                  </div>
                </div>
              );
            })
          )}
            
            {listaExibida.length > ITENS_POR_PAGINA && (
              <div className="pagination-container">
                <button className="page-btn nav-btn" onClick={()=>setPaginaAtual(p=>p-1)} disabled={paginaAtual===1}>Anterior</button>
                {Array.from({length:totalPaginas},(_,i)=>(<button key={i} className={`page-btn ${paginaAtual===i+1?'active':''}`} onClick={()=>setPaginaAtual(i+1)}>{i+1}</button>))}
                <button className="page-btn nav-btn" onClick={()=>setPaginaAtual(p=>p+1)} disabled={paginaAtual===totalPaginas}>Próximo</button>
              </div>
            )}
          </div>
        </div>
      )}
      </>
      )}

    </div>
  )
}

export default App