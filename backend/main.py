from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from unicodedata import normalize
from datetime import datetime
import os
import httpx
import asyncio
import re
from apscheduler.schedulers.background import BackgroundScheduler
import calendar
import logging
from logging.handlers import RotatingFileHandler
from zoneinfo import ZoneInfo
from contextlib import asynccontextmanager

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        RotatingFileHandler("backend_sisreg.log", maxBytes=5*1024*1024, backupCount=3, encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

USUARIO = os.getenv("SISREG_USUARIO")
SENHA = os.getenv("SISREG_SENHA")

if not USUARIO or not SENHA:
    raise RuntimeError("Credenciais SISREG não configuradas no .env")

CODIGO_MUNICIPIO = os.getenv("SISREG_CODIGO_MUNICIPIO", "500830")
AMBIENTE = os.getenv("AMBIENTE", "PRODUCAO") 
VERIFY_SSL = os.getenv("VERIFY_SSL", "False").lower() == "true"
ORIGINS_PERMITIDAS = os.getenv("ORIGINS_PERMITIDAS", "*").split(",")

CACHE_FILAS = {"dados_fila": [], "ultima_atualizacao": None}
CACHE_FALTOMETRO = {"historico_meses": {}, "ultima_atualizacao": None}
CACHE_POSICOES_EXATAS = {}
CACHE_FILAS_ORDENADAS = {}
ULTIMA_ATUALIZACAO_SNAPSHOT = None

@asynccontextmanager
async def lifespan(app: FastAPI):

    fuso_ms = ZoneInfo("America/Campo_Grande")
    scheduler = BackgroundScheduler(timezone=fuso_ms)

    scheduler.add_job(lambda: asyncio.run(atualizar_cache_filas()), 'cron', hour=4, minute=0)
    scheduler.add_job(lambda: asyncio.run(atualizar_cache_faltometro()), 'cron', hour=4, minute=15)
    scheduler.add_job(lambda: asyncio.run(atualizar_posicoes_exatas()), 'cron', hour=4, minute=30)
    scheduler.start()    
    
    asyncio.create_task(inicializacao_assincrona())
    
    yield
    
    scheduler.shutdown()
    logger.info("[SHUTDOWN] Agendador CRON desligado com segurança.")

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS_PERMITIDAS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

PLANILHA_STATUS_TRADUCAO = {
    "SOLICITAÇÃO / PENDENTE / REGULADOR": "Pendente de análise da regulação",
    "SOLICITAÇÃO / DEVOLVIDA / REGULADOR": "Devolvida pela regulação para correção",
    "SOLICITAÇÃO / NEGADA / REGULADOR": "Solicitação negada pela regulação",
    "SOLICITAÇÃO / PENDENTE / FILA DE ESPERA": "Pendente de agendamento (Fila)",
    "SOLICITAÇÃO / REENVIADA / REGULADOR": "Reenviada para análise da regulação",
    "SOLICITAÇÃO / CANCELADA / SOLICITANTE": "Solicitação Cancelada",
    "SOLICITAÇÃO / CANCELADA / REGULADOR": "Solicitação Cancelada",
    "SOLICITAÇÃO / CANCELADA / COORDENADOR": "Solicitação Cancelada",
    "AGENDAMENTO / PENDENTE CONFIRMAÇÃO / EXECUTANTE": "Agendada pendente de confirmação",
    "AGENDAMENTO / CANCELADO / REGULADOR": "Solicitação Cancelada",
    "AGENDAMENTO / CANCELADO / SOLICITANTE": "Solicitação Cancelada",
    "AGENDAMENTO / CANCELADO / COORDENADOR": "Solicitação Cancelada",
    "AGENDAMENTO / CANCELADO": "Solicitação Cancelada",
    "AGENDAMENTO / FALTA / USUARIO": "Paciente não compareceu",
    "FALTA": "Paciente não compareceu"
}

URL_SOLICITACOES_SISREG = os.getenv("SISREG_URL_AMBULATORIAL")
URL_MARCACOES_SISREG = os.getenv("SISREG_URL_MARCACAO")
URL_HOSPITALAR_SISREG = os.getenv("SISREG_URL_HOSPITALAR")

if not URL_SOLICITACOES_SISREG or not URL_MARCACOES_SISREG or not URL_HOSPITALAR_SISREG:
    raise RuntimeError("URLs do SISREG não configuradas no .env")

def normalizar_texto(texto: str):
    if not texto: return ""
    return normalize('NFKD', str(texto)).encode('ASCII', 'ignore').decode('ASCII').lower().strip()

def montar_endereco(obj):
    def get_val(chave):
        val = obj.get(chave)
        return str(val).strip() if val and str(val).strip() else ""

    tipo = get_val("tipo_logradouro_paciente_residencia")
    logradouro = get_val("endereco_paciente_residencia")
    rua = " ".join([t for t in [tipo, logradouro] if t])
    if not rua: return None
    numero = get_val("numero_paciente_residencia")
    num_str = f", n° {numero}" if numero else ", s/n"
    bairro = get_val("bairro_paciente_residencia")
    bairro_str = f", {bairro}" if bairro else ""
    comp = get_val("complemento_paciente_residencia")
    comp_str = f", {comp}" if comp else ""
    cidade = get_val("municipio_paciente_residencia")
    uf = get_val("uf_paciente_residencia")
    cidade_uf = f", {cidade} - {uf}" if cidade and uf else (f", {cidade}" if cidade else "")
    cep = re.sub(r'\D', '', get_val("cep_paciente_residencia"))
    cep_str = f"\nCEP: {cep[:5]}-{cep[5:]}" if len(cep) == 8 else (f", CEP: {cep}" if cep else "")
    
    return f"{rua}{num_str}{comp_str}{bairro_str}{cidade_uf}{cep_str}".upper()

def calcular_peso_risco(status_texto):
    texto = str(status_texto).upper()
    if "VERMELHO" in texto: return 4
    if "AMARELO" in texto: return 3
    if "AZUL" in texto: return 2
    if "VERDE" in texto: return 1
    return 0

def agrupar_nome_procedimento(src):
    if not src:
        return "PROCEDIMENTO NÃO INFORMADO"

    tipo_registro = src.get("tipo_registro", "")
    if tipo_registro == "HOSPITALAR":
        macro = str(src.get("nome_grupo_procedimento", "")).strip()
        micro = str(src.get("descricao_interna_procedimento") or src.get("descricao_procedimento") or src.get("nome_procedimento", "")).strip()
        if macro and micro and macro.upper() != micro.upper():
            return f"{macro.upper()} - {micro.upper()}"
        resultado = micro or macro or "CIRURGIA NÃO DETALHADA"
        return resultado.upper()
    
    proc_lista = src.get("procedimentos")
    if not isinstance(proc_lista, list):
        proc_lista = []
        
    proc_nome = ""
    if len(proc_lista) > 0 and isinstance(proc_lista[0], dict):
        proc_nome = proc_lista[0].get("descricao_sigtap") or proc_lista[0].get("descricao_interna") or proc_lista[0].get("nome_procedimento") or ""

    raw = (
        src.get("descricao_interna_procedimento") or 
        src.get("nome_procedimento") or 
        src.get("descricao_procedimento") or 
        proc_nome or
        src.get("nome_grupo_procedimento") or 
        ""
    )
    
    if not raw or str(raw).strip() == "":
        return "PROCEDIMENTO NÃO INFORMADO"

    limpo = re.sub(r'\s+', ' ', str(raw)).strip().upper()
    norm_limpo = normalizar_texto(limpo)
    
    if "atencao especializada" in norm_limpo or "urgencia" in norm_limpo or "atencao basica" in norm_limpo:
        
        candidatos = [
            ("grupo", src.get("nome_grupo_procedimento")),
            ("direto", src.get("descricao_interna_procedimento")),
            ("direto", src.get("nome_procedimento")),
            ("direto", src.get("descricao_procedimento"))
        ]
        
        for p in proc_lista:
            if isinstance(p, dict):
                candidatos.extend([
                    ("direto", p.get("descricao_sigtap")),
                    ("direto", p.get("descricao_interna")),
                    ("direto", p.get("nome_procedimento"))
                ])

        for tipo, valor in candidatos:
            if not valor: continue
            
            texto_gaveta = re.sub(r'\s+', ' ', str(valor)).strip().upper()
            norm_gaveta = normalizar_texto(texto_gaveta)
            
            if norm_gaveta and norm_gaveta != norm_limpo and "atencao" not in norm_gaveta and "urgencia" not in norm_gaveta and "basica" not in norm_gaveta:
                if tipo == "grupo":
                    return f"CONSULTA ESPECIALIZADA EM {texto_gaveta}"
                return texto_gaveta
                
        return "CONSULTA ESPECIALIZADA (ESPECIALIDADE NÃO INFORMADA PELO SISREG)"

    if len(proc_lista) > 1:
        procedimentos_agrupados = []
        for item in proc_lista:
            if isinstance(item, dict):
                nome_item = item.get("descricao_sigtap") or item.get("descricao_interna") or item.get("nome_procedimento", "")
                if nome_item:
                    nome_limpo = re.sub(r'\s+', ' ', str(nome_item)).strip().upper()
                    norm_item = normalizar_texto(nome_limpo)
                    if "atencao especializada" not in norm_item and "urgencia" not in norm_item:
                        procedimentos_agrupados.append(nome_limpo)
        
        if procedimentos_agrupados:
            unicos = list(dict.fromkeys(procedimentos_agrupados))
            return " + ".join(unicos)

    return limpo

async def atualizar_posicoes_exatas():
    global CACHE_POSICOES_EXATAS
    try:
        logger.info("[CRON] Iniciando Extração Massiva (Scroll API) - Recorte Estrito de 5 Anos...")
        
        ano_limite = datetime.now().year - 5
        data_corte = f"{ano_limite}-01-01T00:00:00"

        payload = {
            "size": 5000,
            "_source": [
                "codigo_solicitacao", 
                "status_solicitacao", 
                "data_solicitacao", 
                "descricao_interna_procedimento",
                "tipo_registro",
                "nome_grupo_procedimento",
                "descricao_procedimento",
                "nome_procedimento",
                "procedimentos"
            ],
            "query": {
                "bool": {
                    "must": [ 
                        { "term": { "codigo_central_reguladora": CODIGO_MUNICIPIO } },
                        { "range": { "data_solicitacao": { "gte": data_corte } } },
                        {
                            "bool": {
                                "should": [
                                    { "match_phrase": { "status_solicitacao": "PENDENTE" } },
                                    { "match_phrase": { "status_solicitacao": "ESPERA" } },
                                    { "match_phrase": { "status_solicitacao": "AGUARDANDO" } },
                                    { "match_phrase": { "status_solicitacao": "REGULADOR" } }
                                ],
                                "minimum_should_match": 1
                            }
                        }
                    ],
                    "must_not": [
                        { "match_phrase": { "status_solicitacao": "AGENDADA" } },
                        { "match_phrase": { "status_solicitacao": "AGENDADO" } },
                        { "match_phrase": { "status_solicitacao": "AGENDAMENTO" } },
                        { "match_phrase": { "status_solicitacao": "CONFIRMADA" } },
                        { "match_phrase": { "status_solicitacao": "CONFIRMADO" } },
                        { "match_phrase": { "status_solicitacao": "AUTORIZADA" } },
                        { "match_phrase": { "status_solicitacao": "AUTORIZADO" } }
                    ]
                }
            }
        }

        registros_totais = []
        ids_unicos_controle = set()
        
        url_base = URL_SOLICITACOES_SISREG
        url_raiz_scroll = "https://sisreg-es.saude.gov.br/_search/scroll"

        async with httpx.AsyncClient(timeout=60.0, verify=VERIFY_SSL) as client:
            resp = await client.post(
                f"{url_base}/_search?scroll=2m", 
                json=payload, 
                headers={"Content-Type": "application/json"}, 
                auth=(USUARIO, SENHA)
            )
            
            if resp.status_code != 200:
                logger.error(f"[CRON ERRO] O Governo rejeitou a abertura do Scroll. Status: {resp.status_code}")
                return

            dados = resp.json()
            scroll_id = dados.get("_scroll_id")
            hits = dados.get("hits", {}).get("hits", [])
            
            for h in hits:
                cod = h.get("_source", {}).get("codigo_solicitacao")
                if cod: ids_unicos_controle.add(str(cod))
            registros_totais.extend(hits)
            
            paginas_processadas = 1
            logger.info(f"[CRON] Página {paginas_processadas} processada. Acumulado: {len(registros_totais)} | Únicos: {len(ids_unicos_controle)}")
            
            while hits and len(hits) > 0 and scroll_id:
                try:
                    resp_scroll = await client.post(
                        url_raiz_scroll,
                        json={"scroll": "2m", "scroll_id": scroll_id},
                        headers={"Content-Type": "application/json"},
                        auth=(USUARIO, SENHA)
                    )
                    
                    if resp_scroll.status_code != 200:
                        logger.warning(f"[CRON AVISO] Interrompendo paginação. Status HTTP: {resp_scroll.status_code}")
                        break

                    dados_scroll = resp_scroll.json()
                    scroll_id = dados_scroll.get("_scroll_id")
                    hits = dados_scroll.get("hits", {}).get("hits", [])
                    
                    if hits and isinstance(hits, list):
                        for h in hits:
                            cod = h.get("_source", {}).get("codigo_solicitacao")
                            if cod: ids_unicos_controle.add(str(cod))
                        
                        registros_totais.extend(hits)
                        paginas_processadas += 1
                        logger.info(f"[CRON] Página {paginas_processadas} processada. Acumulado: {len(registros_totais)} | Únicos: {len(ids_unicos_controle)}")
                    else:
                        break
                        
                except Exception as e_loop:
                    logger.error(f"[CRON ERRO NO LOOP] Falha ao ler página {paginas_processadas + 1}: {e_loop}")
                    break
            
            if scroll_id:
                try:
                    await client.request("DELETE", url_raiz_scroll, json={"scroll_id": scroll_id}, headers={"Content-Type": "application/json"}, auth=(USUARIO, SENHA))
                except: pass

        logger.info(f"[CRON] Extração concluída! Total Geral: {len(registros_totais)} | Total Real Único: {len(ids_unicos_controle)}")

        filas_por_procedimento = {}
        for hit in registros_totais:
            src = hit.get("_source", {})
            
            proc = agrupar_nome_procedimento(src)
            
            if proc not in filas_por_procedimento:
                filas_por_procedimento[proc] = []
                
            filas_por_procedimento[proc].append(src)

        novo_cache = {}
        novo_cache_ordenado = {}

        for proc, pacientes in filas_por_procedimento.items():
            def chave_ordenacao(p):
                peso = calcular_peso_risco(p.get("status_solicitacao", ""))
                data_str = str(p.get("data_solicitacao", "9999-12-31")).replace("Z", "")
                return (-peso, data_str)

            pacientes_ordenados = sorted(pacientes, key=chave_ordenacao)
            lista_parametros = []
            
            for index, pac in enumerate(pacientes_ordenados):
                cod = pac.get("codigo_solicitacao")
                if cod:
                    novo_cache[str(cod)] = index + 1
                    
                peso = calcular_peso_risco(pac.get("status_solicitacao", ""))
                data_str = str(pac.get("data_solicitacao", "9999-12-31")).replace("Z", "")
                lista_parametros.append((-peso, data_str))
                
            novo_cache_ordenado[proc] = lista_parametros

        CACHE_POSICOES_EXATAS = novo_cache
        CACHE_FILAS_ORDENADAS = novo_cache_ordenado
        global ULTIMA_ATUALIZACAO_SNAPSHOT
        ULTIMA_ATUALIZACAO_SNAPSHOT = datetime.now().timestamp()
        
        logger.info(f"[CRON] Snapshot impecável! {len(CACHE_POSICOES_EXATAS)} pacientes divididos em {len(filas_por_procedimento)} filas distintas na memória.")

    except Exception as e:
        logger.error(f"[CRON ERRO CRÍTICO] Falha catastrófica na Scroll API: {e}")

def gerar_mock_supremo_testes(fase_validacao, nome_mae_digitado):
    if fase_validacao:
        nome_mae_limpo = normalizar_texto(nome_mae_digitado).split()[0] if nome_mae_digitado else ""
        if nome_mae_limpo != "margarida":
            raise HTTPException(status_code=403, detail="Nome da mãe incorreto. (Dica do Teste: é Margarida)")

    base_paciente = {
        "no_usuario": "FULANO DA SILVA JUNIOR",
        "dt_nascimento_usuario": "2006-06-19",
        "no_mae_usuario": "MARGARIDA TESTE",
        "endereco_completo": "RUA DAS FLORES, 404 - TRÊS LAGOAS - MS",
        "telefone_unificado": "67999999999, 6733330000"
    }

    return [
        {
            "_source": {
                **base_paciente,
                "codigo_solicitacao": "99990001",
                "tipo_registro": "AMBULATORIAL",
                "status_solicitacao": "SOLICITAÇÃO / PENDENTE / VERMELHO",
                "nome_procedimento": "TOMOGRAFIA COMPUTADORIZADA DE CRÂNIO",
                "data_solicitacao": "2024-05-10T14:30:00",
                "nome_unidade_solicitante": "USF ENGENHARIA DE SOFTWARE",
                "posicao_fila_calculada": 1
            }
        },
        
        {
            "_source": {
                **base_paciente,
                "codigo_solicitacao": "99990002",
                "tipo_registro": "AMBULATORIAL",
                "status_solicitacao": "AGENDAMENTO / CONFIRMADO / EXECUTANTE",
                "nome_procedimento": "CONSULTA EM CARDIOLOGIA",
                "data_solicitacao": "2025-01-10T10:00:00",
                "data_marcacao": "2026-12-25T08:30:00",
                "nome_unidade_solicitante": "USF ENGENHARIA DE SOFTWARE",
                "nome_unidade_executante": "CLÍNICA DO CORAÇÃO FELIZ",
                "telefone_unidade_executante": "6733334444/67988887777"
            }
        },

        {
            "_source": {
                **base_paciente,
                "codigo_solicitacao": "99990003",
                "tipo_registro": "AMBULATORIAL",
                "status_solicitacao": "SOLICITAÇÃO / CANCELADA / REGULADOR",
                "nome_procedimento": "RESSONÂNCIA MAGNÉTICA",
                "data_solicitacao": "2023-11-20T09:15:00",
                "nome_unidade_solicitante": "USF ENGENHARIA DE SOFTWARE",
                "justificativa_impedimento": "Cancelada dia 15/04/2024 - 10:30:22 por admin_regulacao. <b>Paciente não atende aos critérios clínicos exigidos.</b> Faltou anexo de exames anteriores de sangue e raio-x."
            }
        },

        {
            "_source": {
                **base_paciente,
                "codigo_solicitacao": "99990004",
                "tipo_registro": "HOSPITALAR",
                "status_solicitacao": "APROVADA",
                "nome_grupo_procedimento": "ORTOPEDIA",
                "nome_procedimento": "CIRURGIA DE JOELHO DIREITO",
                "data_solicitacao": "2024-01-15T08:00:00",
                "data_reserva": "2026-08-10T07:30:00",
                "nome_unidade_solicitante": "HOSPITAL MUNICIPAL DE TESTES"
            }
        },

        {
            "_source": {
                **base_paciente,
                "codigo_solicitacao": "99990005",
                "tipo_registro": "AMBULATORIAL",
                "status_solicitacao": "AGENDAMENTO / FALTA / EXECUTANTE",
                "nome_procedimento": "CONSULTA EM DERMATOLOGIA",
                "data_solicitacao": "2024-02-01T10:00:00",
                "data_marcacao": "2024-03-01T14:00:00",
                "nome_unidade_solicitante": "USF ENGENHARIA DE SOFTWARE",
                "nome_unidade_executante": "CLÍNICA DA PELE"
            }
        },

        {
            "_source": {
                **base_paciente,
                "codigo_solicitacao": "99990006",
                "tipo_registro": "AMBULATORIAL",
                "status_solicitacao": "SOLICITAÇÃO / DEVOLVIDA / REGULADOR",
                "nome_procedimento": "ULTRASSONOGRAFIA DE TIREOIDE",
                "data_solicitacao": "2026-05-10T08:30:00",
                "nome_unidade_solicitante": "USF ENGENHARIA DE SOFTWARE",
                "justificativa_impedimento": "Faltou anexar o exame de sangue TSH anterior para justificar o pedido."
            }
        },

        {
            "_source": {
                **base_paciente,
                "codigo_solicitacao": "99990007",
                "tipo_registro": "AMBULATORIAL",
                "status_solicitacao": "SOLICITAÇÃO / PENDENTE / AZUL",
                "descricao_interna_procedimento": None,
                "nome_procedimento": None,
                "procedimentos": [
                    {
                        "descricao_sigtap": "CONSULTA EM ENDOCRINOLOGIA E METABOLOGIA",
                        "codigo": "0301010072"
                    }
                ],
                "data_solicitacao": "2025-08-20T11:45:00",
                "nome_unidade_solicitante": "USF ENGENHARIA DE SOFTWARE",
                "posicao_fila_calculada": 42
            }
        },

        {
            "_source": {
                **base_paciente,
                "codigo_solicitacao": "99990008",
                "tipo_registro": "HOSPITALAR",
                "status_solicitacao": "PENDENTE",
                "nome_grupo_procedimento": "NEUROLOGIA",
                "nome_procedimento": "CIRURGIA CRANIANA",
                "data_solicitacao": "2026-06-01T09:00:00",
                "nome_unidade_solicitante": "HOSPITAL MUNICIPAL DE TESTES"
            }
        }
    ]

def traduzir_status_py(status_raw, tipo_registro):
    st = str(status_raw).upper().strip()
    
    if st in PLANILHA_STATUS_TRADUCAO: return PLANILHA_STATUS_TRADUCAO[st]
    
    if tipo_registro == "HOSPITALAR":
        if "APROVADA" in st: return "Cirurgia Aprovada / Agendada"
        if "NEGADA" in st: return "Solicitação de cirurgia negada"
        if "CANCELADA" in st: return "Cirurgia Cancelada"
        if "DEVOLVIDA" in st: return "Devolvida para ajustes médicos"
        if "REENVIADA" in st: return "Reenviada para análise hospitalar"
        if "TROCA" in st: return "Troca de procedimento solicitada"
        if "PENDENTE" in st: return "Pendente de análise hospitalar"
    if "FALTA" in st or "COMPARECEU" in st: return "Paciente não compareceu"
    if "CANCELAD" in st or "NEGAD" in st: return "Solicitação Cancelada"
    if "DEVOLVID" in st: return "Devolvida pela regulação para correção"
    if "REENVIAD" in st or "TROCA" in st: return "Reenviada para análise da regulação"
    if "AGENDAMENT" in st or "AGENDAD" in st or "CONFIRMAD" in st or "AUTORIZAD" in st or "FINALIZAD" in st:
        if "PENDENTE" in st: return "Agendada pendente de confirmação"
        return "Agendada e Confirmada"
    if "PENDENTE" in st or "AGUARDANDO" in st or "ESPERA" in st:
        if "FILA" in st: return "Pendente de agendamento (Fila)"
        return "Pendente de análise da regulação"
    return st

def get_situacao_label_py(status_traduzido):
    st = str(status_traduzido).upper()
    if "AGENDADA" in st or "CONFIRMADA" in st or "AUTORIZADA" in st or "APROVADA" in st: return "SUCESSO"
    if "PENDENTE" in st or "AGUARDANDO" in st or "ESPERA" in st: return "PENDENTE"
    return "OUTRO"

def extrair_ano_py(data_str):
    if not data_str: return ""
    data_str = str(data_str)
    if '-' in data_str: return data_str.split('-')[0]
    if '/' in data_str:
        partes = data_str.split('/')
        if len(partes) == 3: return partes[2][:4]
    return data_str[:4]

@app.get("/api/consulta/{cpf_usuario}")
async def consultar_cpf(cpf_usuario: str, nome_mae: str = Query(None)):

    fase_validacao = bool(nome_mae)

    if not fase_validacao:
        print("="*67, flush=True)
        print(f"|====| NOVA REQUISIÇÃO (FASE 1: BUSCA) - CPF: {cpf_usuario} |====|", flush=True)
        print("="*67, flush=True)
    else:
        print("="*71, flush=True)
        print(f"|====| NOVA REQUISIÇÃO (FASE 2: VALIDAÇÃO) - CPF: {cpf_usuario} |====|", flush=True)
        print("="*71, flush=True)

    try:
        cpf_limpo = cpf_usuario.replace(".", "").replace("-", "").strip()

        if cpf_limpo == "99999999999":
            print("[MOCK] Interceptando requisição. Usando CPF de testes!", flush=True)
            if not fase_validacao:
                return {"status": "aguardando_validacao", "mensagem": "Confirmação necessária"}
            return gerar_mock_supremo_testes(fase_validacao, nome_mae)
        
        payload = {
            "query": { "bool": { "must": [ {"term": {"cpf_usuario": cpf_limpo}} ] } },
            "size": 10000
        }
        
        headers = {"Content-Type": "application/json"}
        auth = (USUARIO, SENHA)

        if not fase_validacao:
            print("[API] Iniciando consulta assíncrona dupla ao Governo...", flush=True)

        async def fazer_requisicao(url, nome_busca):
            async with httpx.AsyncClient(timeout=30.0, verify=VERIFY_SSL) as client:
                try:
                    resp = await client.post(url + "/_search", json=payload, headers=headers, auth=auth)
                    if resp.status_code == 200:
                        hits = resp.json().get("hits", {}).get("hits", [])
                        logger.info(f"[API] {nome_busca} finalizadas: {len(hits)} encontradas.")
                        return hits
                except httpx.TimeoutException as e:
                    logger.error(f"[ERRO] O servidor do governo demorou muito a responder em {nome_busca}: {e}")
                except httpx.RequestError as e:
                    logger.error(f"[ERRO] Falha de conexão de rede em {nome_busca}: {e}")
                except Exception as e:
                    logger.error(f"[ERRO] Erro inesperado ao buscar {nome_busca}: {e}")
                return []

        tarefas = [
            fazer_requisicao(URL_SOLICITACOES_SISREG, "Solicitações"),
            fazer_requisicao(URL_MARCACOES_SISREG, "Marcações"),
            fazer_requisicao(URL_HOSPITALAR_SISREG, "Cirurgias")
        ]

        resultados = await asyncio.gather(*tarefas)
        
        lista_solicitacoes, lista_marcacoes, lista_hospitalar = resultados

        if not lista_solicitacoes and not lista_marcacoes and not lista_hospitalar:
            print("[FIM] Nenhum registro encontrado em nenhuma base.", flush=True)
            return []

        mapa_marcacoes = {}
        for item in lista_marcacoes:
            m_source = item.get("_source", {})
            dt_m = m_source.get("data_solicitacao")
            if dt_m:
                chave = dt_m[:10]
                if chave not in mapa_marcacoes:
                    mapa_marcacoes[chave] = []
                mapa_marcacoes[chave].append(m_source)

        dados_brutos = []

        if lista_solicitacoes:
            for item in lista_solicitacoes:
                if "_source" not in item: item["_source"] = {}
                source = item["_source"]
                source["tipo_registro"] = "AMBULATORIAL"
                dt_s = source.get("data_solicitacao")    
                chave = dt_s[:10] if dt_s else None
                m_dados = {}
                
                if chave and mapa_marcacoes.get(chave):
                    m_dados = mapa_marcacoes[chave].pop(0)
                
                chaves_tels = ["telefone_paciente","telefone"]
                tels_encontrados = []
                for obj in [source, m_dados]:
                    for k in chaves_tels:
                        v = obj.get(k)
                        if v:
                            partes = str(v).replace(";", ",").split(",")
                            for p in partes:
                                p_limpo = re.sub(r'\D', '', str(p))
                                if p_limpo and p_limpo not in tels_encontrados:
                                    tels_encontrados.append(p_limpo)
                
                item["_source"]["telefone_unificado"] = ", ".join(tels_encontrados) or "Não informado"
                item["_source"]["endereco_completo"] = montar_endereco(source) or montar_endereco(m_dados) or "Endereço não informado"

                if chave in mapa_marcacoes:
                    for campo in ["data_marcacao", "nome_unidade_executante", "status_solicitacao", 
                                 "descricao_interna_procedimento", "nome_grupo_procedimento", "telefone_unidade_executante"]:
                        if m_dados.get(campo):
                            item["_source"][campo] = m_dados.get(campo)
                            
            dados_brutos.extend(lista_solicitacoes)
            
        for lista_m in mapa_marcacoes.values():
            for m_source in lista_m:
                novo_item = {"_source": m_source}
                m_source["tipo_registro"] = "AMBULATORIAL"
                tel = m_source.get("telefone_paciente") or m_source.get("telefone") or ""
                novo_item["_source"]["telefone_unificado"] = re.sub(r'\D', '', str(tel)) or "Não informado"
                novo_item["_source"]["endereco_completo"] = montar_endereco(m_source) or "Endereço não informado"
                dados_brutos.append(novo_item)

        if lista_hospitalar:
            for item in lista_hospitalar:
                if "_source" not in item: item["_source"] = {}
                source = item["_source"]
                status_bruto = str(source.get("status", source.get("status_solicitacao", "PENDENTE"))).upper().strip()
                item["_source"]["status_solicitacao"] = status_bruto
                tel = source.get("telefone_paciente") or source.get("telefone") or ""
                item["_source"]["telefone_unificado"] = re.sub(r'\D', '', str(tel)) or "Não informado"
                item["_source"]["endereco_completo"] = montar_endereco(source) or "Endereço não informado"
                item["_source"]["tipo_registro"] = "HOSPITALAR"
            dados_brutos.extend(lista_hospitalar)

        dados_finais = []
        ano_limite = datetime.now().year - 5

        for item in dados_brutos:
            source = item.get("_source", {})
            data_ref = source.get("data_solicitacao") or source.get("data_marcacao") or source.get("data_atualizacao")
            ano_str = extrair_ano_py(data_ref)
            
            if not ano_str.isdigit():
                dados_finais.append(item)
                continue
                
            if int(ano_str) >= ano_limite:
                dados_finais.append(item)
                continue
                
            st_bruto = str(source.get("status_solicitacao", "")).upper()
            tp_reg = str(source.get("tipo_registro", "AMBULATORIAL")).upper()
            
            st_traduzido = traduzir_status_py(st_bruto, tp_reg)
            if get_situacao_label_py(st_traduzido) == "PENDENTE":
                dados_finais.append(item)

        if not dados_finais:
            print("[FIM] Nenhum registro ativo nos últimos 5 anos.", flush=True)
            return []
        
        nome_mae_banco = ""
        for item in dados_finais:
            mae = item.get("_source", {}).get("no_mae_usuario", "")
            if mae and str(mae).strip():
                nome_mae_banco = str(mae).strip()
                break

        if not fase_validacao:
            print(f"[API] Total Unificado Filtrado: {len(dados_finais)}", flush=True)
            print("[SEGURANÇA] Solicitando nome da mãe ao usuário...", flush=True)
            return {
                "status": "aguardando_validacao",
                "mensagem": "Confirmação necessária"
            }

        nome_real_norm = normalizar_texto(nome_mae_banco)
        nome_digitado_norm = normalizar_texto(nome_mae)

        primeiro_nome_real = nome_real_norm.split()[0] if nome_real_norm else ""
        primeiro_nome_digitado = nome_digitado_norm.split()[0] if nome_digitado_norm else ""

        print(f"[VALIDAÇÃO] Comparando: Banco['{primeiro_nome_real}'] vs Digitado['{primeiro_nome_digitado}']", flush=True)

        if not primeiro_nome_real:
             print("[ERRO CRÍTICO] Cadastro no banco sem nome da mãe.", flush=True)
             raise HTTPException(status_code=403, detail="Dados cadastrais incompletos no sistema.")

        if primeiro_nome_real != primeiro_nome_digitado:
            print("[VALIDAÇÃO] Falha: Nomes não conferem.", flush=True)
            raise HTTPException(status_code=403, detail="Nome da mãe incorreto")
        
        print("[SUCESSO!] Acesso liberado. Enviando dados ao Frontend.", flush=True)

        for item in dados_finais:
            cod = item.get("_source", {}).get("codigo_solicitacao")
            if cod and str(cod) in CACHE_POSICOES_EXATAS:
                item["_source"]["posicao_fila_calculada"] = CACHE_POSICOES_EXATAS[str(cod)]

        return dados_finais

    except Exception as e:
        print(f"[EXCEÇÃO] Ocorreu um erro: {e}", flush=True)
 
async def atualizar_cache_filas():
    global CACHE_FILAS
    try:
        logger.info("[CRON] Iniciando atualização diária das filas às 04:00 da manhã...")

        payload = {
            "size": 10000, 
            "_source": [
                "descricao_interna_procedimento",
                "procedimentos.descricao_interna",
                "status_solicitacao"
            ],
            "query": {
                "bool": {
                    "must": [
                        { "term": { "codigo_central_reguladora": CODIGO_MUNICIPIO } }
                    ],
                    "should": [
                        { "match_phrase": { "status_solicitacao": "SOLICITAÇÃO / PENDENTE / REGULADOR" } },
                        { "match_phrase": { "status_solicitacao": "SOLICITAÇÃO / PENDENTE / FILA DE ESPERA" } },
                        { "match_phrase": { "status_solicitacao": "SOLICITAÇÃO / REENVIADA / REGULADOR" } }
                    ],
                    "minimum_should_match": 1
                }
            }
        }

        async with httpx.AsyncClient(timeout=30.0, verify=VERIFY_SSL) as client:
            resp = await client.post(
                f"{URL_SOLICITACOES_SISREG}/_search", 
                json=payload, 
                headers={"Content-Type": "application/json"}, 
                auth=(USUARIO, SENHA)
            )
            dados_json = resp.json()
        
        registros = dados_json.get("hits", {}).get("hits", [])
        
        mapa_procedimentos = {}

        for hit in registros:
            source = hit.get("_source", {})
            
            nome_limpo = agrupar_nome_procedimento(source)
                
            if nome_limpo in mapa_procedimentos:
                mapa_procedimentos[nome_limpo] += 1
            else:
                mapa_procedimentos[nome_limpo] = 1

        dados_fila = [{"especialidade": k, "quantidade": v} for k, v in mapa_procedimentos.items()]
        dados_fila.sort(key=lambda x: x["quantidade"], reverse=True)

        CACHE_FILAS["dados_fila"] = dados_fila
        CACHE_FILAS["ultima_atualizacao"] = datetime.now().strftime("%d/%m/%Y às %H:%M")
        logger.info("[CRON] Cache das filas atualizado com sucesso!")

    except Exception as e:
        logger.error(f"[CRON ERRO] Falha ao atualizar cache: {e}")

@app.get("/api/filas-espera")
async def obter_filas_espera():
    return CACHE_FILAS

async def atualizar_cache_faltometro():
    global CACHE_FALTOMETRO
    try:
        logger.info("[CRON] Iniciando extração dos últimos 6 meses para o Faltômetro...")

        hoje = datetime.now()
        dados_por_mes = {}

        for i in range(5, -1, -1): 
            mes_alvo = hoje.month - i
            ano_alvo = hoje.year
            
            if mes_alvo <= 0:
                mes_alvo += 12
                ano_alvo -= 1
                
            primeiro_dia = f"{ano_alvo}-{mes_alvo:02d}-01"
            ultimo_dia_mes = calendar.monthrange(ano_alvo, mes_alvo)[1]
            ultimo_dia = f"{ano_alvo}-{mes_alvo:02d}-{ultimo_dia_mes}"
            
            chave_mes = f"{mes_alvo:02d}/{ano_alvo}"

            dados_por_mes[chave_mes] = {
                "total_agendamentos": 0,
                "total_faltas_geral": 0,
                "especialidades": {}
            }

            payload = {
                "size": 10000, 
                "_source": ["nome_grupo_procedimento", "status_solicitacao"],
                "query": {
                    "bool": {
                        "must": [
                            { "term": { "codigo_central_reguladora": CODIGO_MUNICIPIO } },
                            {
                                "range": {
                                    "data_marcacao": {
                                        "gte": f"{primeiro_dia}T00:00:00",
                                        "lte": f"{ultimo_dia}T23:59:59"
                                    }
                                }
                            }
                        ]
                    }
                }
            }

            async with httpx.AsyncClient(timeout=30.0, verify=VERIFY_SSL) as client:
                resp = await client.post(
                    f"{URL_MARCACOES_SISREG}/_search", 
                    json=payload, 
                    headers={"Content-Type": "application/json"}, 
                    auth=(USUARIO, SENHA)
                )
                dados_json = resp.json()
            
            registros = dados_json.get("hits", {}).get("hits", [])
            
            for hit in registros:
                source = hit.get("_source", {})
                status = str(source.get("status_solicitacao", "")).upper()
                
                especialidade = agrupar_nome_procedimento(source)
                
                if "PENDENTE" in status or "CANCELADA" in status or "DEVOLVIDA" in status or "NÃO INFORMADO" in especialidade:
                    continue

                especialidade = especialidade.replace("GRUPO - ", "").strip()
                mes_ref = dados_por_mes[chave_mes]                
                mes_ref["total_agendamentos"] += 1
                
                if especialidade not in mes_ref["especialidades"]:
                    mes_ref["especialidades"][especialidade] = {"agendados": 0, "faltas": 0}
                    
                mes_ref["especialidades"][especialidade]["agendados"] += 1

                if "AGENDAMENTO / FALTA / EXECUTANTE" in status:
                    mes_ref["total_faltas_geral"] += 1
                    mes_ref["especialidades"][especialidade]["faltas"] += 1

        cache_final = {}
        for mes, info in dados_por_mes.items():
            lista_especialidades = []
            
            for esp, nums in info["especialidades"].items():
                if nums["faltas"] > 0: 
                    taxa = (nums["faltas"] / nums["agendados"]) * 100
                    lista_especialidades.append({
                        "especialidade": esp,
                        "agendados": nums["agendados"],
                        "faltas": nums["faltas"],
                        "taxa_evasao": round(taxa, 1)
                    })

            lista_especialidades.sort(key=lambda x: x["faltas"], reverse=True)

            if info["total_agendamentos"] > 0:
                cache_final[mes] = {
                    "resumo": {
                        "total_avaliado": info["total_agendamentos"],
                        "ausencias_totais": info["total_faltas_geral"]
                    },
                    "dados_faltas": lista_especialidades
                }

        CACHE_FALTOMETRO["historico_meses"] = cache_final
        CACHE_FALTOMETRO["ultima_atualizacao"] = datetime.now().strftime("%d/%m/%Y às %H:%M")
        
        logger.info(f"[CRON] Faltômetro atualizado! Meses processados: {list(cache_final.keys())}")

    except Exception as e:
        logger.error(f"[CRON ERRO] Falha ao processar Faltômetro: {e}")

@app.get("/api/faltometro")
async def obter_faltometro():
    return CACHE_FALTOMETRO

async def boot_filas():
    try: 
        await atualizar_cache_filas()
    except Exception as e: 
        logger.error(f"[BOOT ERRO] Filas: {type(e).__name__} - {e}")

async def boot_faltometro():
    await asyncio.sleep(5)
    try: 
        await atualizar_cache_faltometro()
    except Exception as e: 
        logger.error(f"[BOOT ERRO] Faltômetro: {type(e).__name__} - {e}")

async def boot_posicoes():
    await asyncio.sleep(1)
    try: 
        await atualizar_posicoes_exatas()
    except Exception as e: 
        logger.error(f"[BOOT ERRO] Posições Exatas: {type(e).__name__} - {e}")

async def inicializacao_assincrona():
    logger.info("[BOOT] Disparando extrações paralelas em cascata...")
    asyncio.create_task(boot_filas())
    asyncio.create_task(boot_faltometro())
    asyncio.create_task(boot_posicoes())
    logger.info("[BOOT] Tarefas enviadas para o background! O servidor já está livre para responder.")

@app.get("/api/status-snapshot")
async def obter_status_snapshot():
    return {"ultima_atualizacao": ULTIMA_ATUALIZACAO_SNAPSHOT}

@app.get("/api/posicao-fila")
async def calcular_posicao_endpoint(
    procedimento: str = Query(...),
    status: str = Query(...),
    data_solic: str = Query(...)
):
    if not CACHE_FILAS_ORDENADAS:
        raise HTTPException(status_code=503, detail="Servidor sincronizando filas do Ministério da Saúde. Tente novamente em 2 minutos.")
        
    try:
        proc_upper = str(procedimento).strip().upper()
        fila_referencia = CACHE_FILAS_ORDENADAS.get(proc_upper)
        
        if not fila_referencia:
            return {"posicao_fila": 1}
            
        peso_novo = calcular_peso_risco(status)
        data_nova_str = str(data_solic).replace("Z", "").replace(" ", "T")
        if len(data_nova_str) == 10: data_nova_str += "T00:00:00"
        if len(data_nova_str) > 19: data_nova_str = data_nova_str[:19]
        
        chave_novo = (-peso_novo, data_nova_str)
        posicao = 1
        
        for tupla_paciente_existente in fila_referencia:
            if tupla_paciente_existente < chave_novo:
                posicao += 1
            else:
                break
                
        return {"posicao_fila": posicao}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))