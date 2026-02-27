from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from unicodedata import normalize
from datetime import datetime
import os
import httpx
import asyncio
import re

load_dotenv()

USUARIO = os.getenv("SISREG_USUARIO")
SENHA = os.getenv("SISREG_SENHA")

app = FastAPI()

# ATENÇÃO EQUIPE DE TI DA PREFEITURA: 
# Quando forem subir pra internet, troquem o ["*"] pelo domínio oficial.
# Exemplo: allow_origins=["https://transparencia.treslagoas.ms.gov.br"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

URL_SOLICITACOES_SISREG = "https://sisreg-es.saude.gov.br/solicitacao-ambulatorial-ms-tres-lagoas"
URL_MARCACOES_SISREG = "https://sisreg-es.saude.gov.br/marcacao-ambulatorial-ms-tres-lagoas"

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
        
        payload = {
            "query": { "bool": { "must": [ {"term": {"cpf_usuario": cpf_limpo}} ] } },
            "size": 10000
        }
        
        headers = {"Content-Type": "application/json"}
        auth = (USUARIO, SENHA)

        if not fase_validacao:
            print("[API] Iniciando consulta assíncrona dupla ao Governo...", flush=True)

        async def fazer_requisicao(url, nome_busca):
            async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
                try:
                    resp = await client.post(url + "/_search", json=payload, headers=headers, auth=auth)
                    if resp.status_code == 200:
                        hits = resp.json().get("hits", {}).get("hits", [])
                        if not fase_validacao:
                            print(f"[API] {nome_busca} finalizadas: {len(hits)} encontradas.", flush=True)
                        return hits
                except Exception as e:
                    print(f"[ERRO] Falha ao buscar {nome_busca}: {e}", flush=True)
                return []

        tarefas = [
            fazer_requisicao(URL_SOLICITACOES_SISREG, "Solicitações"),
            fazer_requisicao(URL_MARCACOES_SISREG, "Marcações")
        ]

        resultados = await asyncio.gather(*tarefas)
        
        lista_solicitacoes = resultados[0]
        lista_marcacoes = resultados[1]

        if not lista_solicitacoes and not lista_marcacoes:
            print("[FIM] Nenhum registro encontrado.", flush=True)
            return []

        mapa_marcacoes = {}
        for item in lista_marcacoes:
            m_source = item.get("_source", {})
            dt_m = m_source.get("data_solicitacao")
            if dt_m:
                chave = dt_m[:10]
                mapa_marcacoes[chave] = m_source

        if lista_solicitacoes:
            for item in lista_solicitacoes:
                source = item.get("_source", {})
                dt_s = source.get("data_solicitacao")
                chave = dt_s[:10] if dt_s else None
                m_dados = mapa_marcacoes.get(chave, {}) if chave else {}
                
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
                
                endereco = montar_endereco(source) or montar_endereco(m_dados)
                item["_source"]["endereco_completo"] = endereco or "Endereço não informado"

                if chave in mapa_marcacoes:
                    for campo in ["data_marcacao", "nome_unidade_executante", "status_solicitacao", 
                                 "descricao_interna_procedimento", "nome_grupo_procedimento", "telefone_unidade_executante"]:
                        if m_dados.get(campo):
                            item["_source"][campo] = m_dados.get(campo)
                            
            dados_finais = lista_solicitacoes
            
        else:
            for item in lista_marcacoes:
                source = item.get("_source", {})
                
                tel = source.get("telefone_paciente") or source.get("telefone") or ""
                item["_source"]["telefone_unificado"] = re.sub(r'\D', '', str(tel)) or "Não informado"
                item["_source"]["endereco_completo"] = montar_endereco(source) or "Endereço não informado"
                
            dados_finais = lista_marcacoes
        
        primeiro_registro = dados_finais[0].get("_source", {})
        nome_mae_banco = primeiro_registro.get("no_mae_usuario", "")

        if not fase_validacao:
            print(f"[API] Total Unificado: {len(dados_finais)}", flush=True)
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
        
        ano_atual = datetime.now().year
        ano_limite = ano_atual - 5
        contador_front = 0

        for item in dados_finais:
            source = item.get("_source", {})
            data_ref = source.get("data_solicitacao") or source.get("data_marcacao") or source.get("data_atualizacao")
            
            ano_str = str(data_ref)[:4] if data_ref else ""
            
            if not ano_str.isdigit():
                contador_front += 1
            else:
                ano = int(ano_str)
                if ano >= ano_limite:
                    contador_front += 1
                else:
                    status = str(source.get("status_solicitacao", "")).upper()
                    if "PENDENTE" in status or "AGUARDANDO" in status or "ESPERA" in status:
                        contador_front += 1
        
        print(f"[>> VERIFICAÇÃO <<] O Front-end DEVE exibir exatamente: {contador_front} procedimentos.", flush=True)
        print("[SUCESSO!] Acesso liberado. Enviando dados ao Frontend.", flush=True)
        return dados_finais

    except Exception as e:
        print(f"[EXCEÇÃO] Ocorreu um erro: {e}", flush=True)
        if isinstance(e, HTTPException):
            raise e
        return []