from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from unicodedata import normalize
import os
import requests
import re
import json

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

URL_SOLICITACOES_SISREG = "https://sisreg-es.saude.gov.br/solicitacao-ambulatorial-ms-tres-lagoas"
URL_MARCACOES_SISREG = "https://sisreg-es.saude.gov.br/marcacao-ambulatorial-ms-tres-lagoas"

def normalizar_texto(texto: str):
    if not texto: return ""
    return normalize('NFKD', str(texto)).encode('ASCII', 'ignore').decode('ASCII').lower().strip()

def formatar_telefone_mascara(tel):
    if not tel: return ""
    apenas_numeros = re.sub(r'\D', '', str(tel))
    if len(apenas_numeros) == 11:
        return f"({apenas_numeros[:2]}) {apenas_numeros[2:7]}-{apenas_numeros[7:]}"
    elif len(apenas_numeros) == 10:
        return f"({apenas_numeros[:2]}) {apenas_numeros[2:6]}-{apenas_numeros[6:]}"
    return tel

@app.get("/api/consulta/{cpf_usuario}")
def consultar_cpf(cpf_usuario: str, nome_mae: str = Query(None)):
    USUARIO = os.getenv("SISREG_USUARIO")
    SENHA = os.getenv("SISREG_SENHA")

    print("\n" + "="*60, flush=True)
    print(f"|====| NOVA REQUISIÇÃO RECEBIDA - CPF: {cpf_usuario} |====|", flush=True)
    print("="*60, flush=True)

    try:
        cpf_limpo = cpf_usuario.replace(".", "").replace("-", "")

        print("[API] Iniciando consulta ao Governo (Busca Dupla)...", flush=True)
        
        payload = {
            "query": {
                "bool": {
                    "must": [
                        {"term": {"cpf_usuario": cpf_limpo}}
                    ]
                }
            },
            "size": 10000
        }
        
        headers = {"Content-Type": "application/json"}
        auth = (USUARIO, SENHA)
        lista_solicitacoes = []
        lista_marcacoes = []

        print("[API] Consultando Solicitações...", flush=True)
        try:
            resp_solic = requests.post(URL_SOLICITACOES_SISREG + "/_search", json=payload, headers=headers, auth=auth, timeout=30)
            if resp_solic.status_code == 200:
                lista_solicitacoes = resp_solic.json().get("hits", {}).get("hits", [])
                print(f"[API] Solicitações encontradas: {len(lista_solicitacoes)}", flush=True)
        except:
            pass

        print("[API] Consultando Marcações...", flush=True)
        try:
            resp_marc = requests.post(URL_MARCACOES_SISREG + "/_search", json=payload, headers=headers, auth=auth, timeout=30)
            if resp_marc.status_code == 200:
                lista_marcacoes = resp_marc.json().get("hits", {}).get("hits", [])
                print(f"[API] Marcações encontradas: {len(lista_marcacoes)}", flush=True)
        except:
            pass

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

        for item in lista_solicitacoes:
            source = item.get("_source", {})
            dt_s = source.get("data_solicitacao")
            chave = dt_s[:10] if dt_s else None
            m_dados = mapa_marcacoes.get(chave, {}) if chave else {}
            
            chaves_tels = ["telefone_paciente", "telefone"]
            tels_encontrados = []
            for obj in [source, m_dados]:
                for k in chaves_tels:
                    v = obj.get(k)
                    if v:
                        partes = str(v).replace(";", ",").split(",")
                        for p in partes:
                            p_formatado = formatar_telefone_mascara(p.strip())
                            if p_formatado and p_formatado not in tels_encontrados:
                                tels_encontrados.append(p_formatado)
            
            item["_source"]["telefone_unificado"] = ", ".join(tels_encontrados) or "Não informado"

            def montar_endereco(obj):
                partes = [obj.get("tipo_logradouro_paciente_residencia"), obj.get("endereco_paciente_residencia"), obj.get("numero_paciente_residencia")]
                rua = " ".join([str(p).strip() for p in partes if p and str(p).strip()])
                bairro = obj.get("bairro_paciente_residencia")
                cidade = obj.get("municipio_paciente_residencia")
                if not rua: return None
                return f"{rua} - {bairro}, {cidade}" if bairro else rua

            endereco = montar_endereco(source) or montar_endereco(m_dados)
            item["_source"]["endereco_completo"] = endereco or "Endereço não informado"

            if chave in mapa_marcacoes:
                for campo in ["data_marcacao", "nome_unidade_executante", "status_solicitacao", 
                             "descricao_interna_procedimento", "nome_grupo_procedimento"]:
                    if m_dados.get(campo):
                        item["_source"][campo] = m_dados.get(campo)

        print(f"[API] Total Unificado (Sem duplicatas): {len(lista_solicitacoes)}", flush=True)
        
        primeiro_registro = lista_solicitacoes[0].get("_source", {}) if lista_solicitacoes else lista_marcacoes[0].get("_source", {})
        nome_mae_banco = primeiro_registro.get("no_mae_usuario", "")

        if not nome_mae:
            print("[SEGURANÇA] Nome da mãe não informado. Solicitando ao usuário...", flush=True)
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

        print("[SUCESSO!] Acesso liberado. Enviando dados unificados.", flush=True)
        return lista_solicitacoes

    except Exception as e:
        print(f"[EXCEÇÃO] Ocorreu um erro: {e}", flush=True)
        if isinstance(e, HTTPException):
            raise e
        return []
    finally:
        print("="*60 + "\n", flush=True)